-- Website artwork upload sessions.
-- Apply manually. Do not run from the app.
--
-- quote_request_dropbox_files can already store a finished file. These columns
-- and functions let two server instances share one Dropbox upload without
-- keeping the lock in memory. A conditional update is not enough on its own:
-- a retried chunk and a conflicting chunk can carry the same offset, so the
-- last accepted checksum is stored as well.
--
-- Completed rows clear dropbox_upload_session_id. Failed rows are identifiable
-- by upload_status = 'failed'. Existing rows stay valid: new columns are
-- nullable or defaulted, and no existing check is tightened.
-- Customer portal attachment policies are not changed.

BEGIN;

ALTER TABLE public.quote_request_dropbox_files
  ADD COLUMN IF NOT EXISTS dropbox_upload_session_id text,
  ADD COLUMN IF NOT EXISTS upload_session_offset bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS append_claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS append_claim_offset bigint,
  ADD COLUMN IF NOT EXISTS append_claim_bytes integer,
  ADD COLUMN IF NOT EXISTS append_claim_kind text,
  ADD COLUMN IF NOT EXISTS last_accepted_offset bigint,
  ADD COLUMN IF NOT EXISTS last_accepted_bytes integer,
  ADD COLUMN IF NOT EXISTS last_accepted_sha256 text;

COMMENT ON COLUMN public.quote_request_dropbox_files.dropbox_upload_session_id IS
  'Dropbox upload session for an in-progress website file. Cleared when the file is uploaded or failed. Not an access token.';

COMMENT ON COLUMN public.quote_request_dropbox_files.upload_session_offset IS
  'Bytes already accepted into the Dropbox upload session.';

ALTER TABLE public.quote_request_dropbox_files
  DROP CONSTRAINT IF EXISTS quote_request_dropbox_files_offset_non_negative;

ALTER TABLE public.quote_request_dropbox_files
  ADD CONSTRAINT quote_request_dropbox_files_offset_non_negative
  CHECK (upload_session_offset >= 0);

ALTER TABLE public.quote_request_dropbox_files
  DROP CONSTRAINT IF EXISTS quote_request_dropbox_files_session_not_url;

ALTER TABLE public.quote_request_dropbox_files
  ADD CONSTRAINT quote_request_dropbox_files_session_not_url
  CHECK (
    dropbox_upload_session_id IS NULL
    OR dropbox_upload_session_id !~* '^https?://'
  );

ALTER TABLE public.quote_request_dropbox_files
  DROP CONSTRAINT IF EXISTS quote_request_dropbox_files_claim_kind_check;

ALTER TABLE public.quote_request_dropbox_files
  ADD CONSTRAINT quote_request_dropbox_files_claim_kind_check
  CHECK (append_claim_kind IS NULL OR append_claim_kind IN ('chunk', 'finish'));

ALTER TABLE public.quote_request_dropbox_files
  DROP CONSTRAINT IF EXISTS quote_request_dropbox_files_chunk_sha_check;

ALTER TABLE public.quote_request_dropbox_files
  ADD CONSTRAINT quote_request_dropbox_files_chunk_sha_check
  CHECK (
    last_accepted_sha256 IS NULL
    OR last_accepted_sha256 ~ '^[0-9a-f]{64}$'
  );

CREATE OR REPLACE FUNCTION public.quote_request_dropbox_suffixed_name(
  p_name text,
  p_attempt integer
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_extension text;
  v_base text;
BEGIN
  IF p_attempt <= 1 THEN
    RETURN p_name;
  END IF;

  IF p_name ~ '\.[A-Za-z0-9]+$' THEN
    v_extension := substring(p_name from '\.([A-Za-z0-9]+)$');
    v_base := regexp_replace(p_name, '\.[A-Za-z0-9]+$', '');
    RETURN v_base || '_' || p_attempt::text || '.' || v_extension;
  END IF;

  RETURN p_name || '_' || p_attempt::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.quote_request_dropbox_reserve_file(
  p_quote_request_id uuid,
  p_external_submission_id text,
  p_original_file_name text,
  p_stored_file_name text,
  p_folder_path text,
  p_file_size_bytes bigint,
  p_mime_type text,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source text;
  v_submission text;
  v_count integer;
  v_attempt integer;
  v_name text;
  v_path text;
  v_id uuid;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Website artwork updates are server-only'
      USING ERRCODE = '42501';
  END IF;

  IF p_file_size_bytes IS NULL
    OR p_file_size_bytes <= 0
    OR p_file_size_bytes > 524288000 THEN
    RETURN jsonb_build_object('outcome', 'too_large');
  END IF;

  IF p_stored_file_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'
    OR p_folder_path IS NULL
    OR p_folder_path !~ '^(/[A-Za-z0-9][A-Za-z0-9 ._-]{0,200})+$'
    OR p_folder_path LIKE '%..%'
    OR position('://' IN p_folder_path) > 0
    OR btrim(coalesce(p_original_file_name, '')) = '' THEN
    RETURN jsonb_build_object('outcome', 'invalid_path');
  END IF;

  SELECT quote_requests.source, quote_requests.external_submission_id
  INTO v_source, v_submission
  FROM public.quote_requests
  WHERE quote_requests.id = p_quote_request_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_source IS DISTINCT FROM 'website'
    OR v_submission IS DISTINCT FROM p_external_submission_id THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  UPDATE public.quote_request_dropbox_files
  SET
    upload_status = 'failed',
    dropbox_upload_session_id = NULL,
    append_claim_expires_at = NULL,
    append_claim_offset = NULL,
    append_claim_bytes = NULL,
    append_claim_kind = NULL
  WHERE quote_request_id = p_quote_request_id
    AND upload_status = 'pending'
    AND (
      (session_expires_at IS NOT NULL AND session_expires_at <= p_now)
      OR (
        dropbox_upload_session_id IS NULL
        AND created_at <= p_now - interval '15 minutes'
      )
    );

  SELECT count(*)
  INTO v_count
  FROM public.quote_request_dropbox_files
  WHERE quote_request_id = p_quote_request_id
    AND upload_status <> 'failed';

  IF v_count >= 10 THEN
    RETURN jsonb_build_object('outcome', 'file_limit');
  END IF;

  v_name := NULL;
  FOR v_attempt IN 1..20 LOOP
    v_name := public.quote_request_dropbox_suffixed_name(p_stored_file_name, v_attempt);
    v_path := p_folder_path || '/' || v_name;
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.quote_request_dropbox_files
      WHERE quote_request_id = p_quote_request_id
        AND upload_status <> 'failed'
        AND dropbox_path = v_path
    );
    v_name := NULL;
  END LOOP;

  IF v_name IS NULL THEN
    RETURN jsonb_build_object('outcome', 'name_taken');
  END IF;

  INSERT INTO public.quote_request_dropbox_files (
    quote_request_id,
    original_file_name,
    dropbox_path,
    file_size_bytes,
    mime_type,
    upload_status,
    upload_session_offset
  )
  VALUES (
    p_quote_request_id,
    btrim(p_original_file_name),
    v_path,
    p_file_size_bytes,
    NULLIF(btrim(coalesce(p_mime_type, '')), ''),
    'pending',
    0
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'outcome', 'reserved',
    'fileId', v_id,
    'dropboxPath', v_path
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.quote_request_dropbox_attach_session(
  p_file_id uuid,
  p_quote_request_id uuid,
  p_session_id text,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Website artwork updates are server-only'
      USING ERRCODE = '42501';
  END IF;

  IF p_session_id IS NULL
    OR btrim(p_session_id) = ''
    OR p_session_id ~* '^https?://' THEN
    RETURN jsonb_build_object('outcome', 'invalid_session');
  END IF;

  UPDATE public.quote_request_dropbox_files
  SET
    dropbox_upload_session_id = btrim(p_session_id),
    session_expires_at = p_now + interval '7 days'
  WHERE id = p_file_id
    AND quote_request_id = p_quote_request_id
    AND upload_status = 'pending'
    AND dropbox_upload_session_id IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_pending');
  END IF;

  RETURN jsonb_build_object('outcome', 'attached');
END;
$$;

CREATE OR REPLACE FUNCTION public.quote_request_dropbox_fail_file(
  p_file_id uuid,
  p_quote_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Website artwork updates are server-only'
      USING ERRCODE = '42501';
  END IF;

  SELECT upload_status
  INTO v_status
  FROM public.quote_request_dropbox_files
  WHERE id = p_file_id
    AND quote_request_id = p_quote_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF v_status = 'uploaded' THEN
    RETURN jsonb_build_object('outcome', 'uploaded');
  END IF;

  UPDATE public.quote_request_dropbox_files
  SET
    upload_status = 'failed',
    dropbox_upload_session_id = NULL,
    append_claim_expires_at = NULL,
    append_claim_offset = NULL,
    append_claim_bytes = NULL,
    append_claim_kind = NULL
  WHERE id = p_file_id
    AND quote_request_id = p_quote_request_id
    AND upload_status = 'pending';

  RETURN jsonb_build_object('outcome', 'failed');
END;
$$;

CREATE OR REPLACE FUNCTION public.quote_request_dropbox_claim_chunk(
  p_file_id uuid,
  p_quote_request_id uuid,
  p_offset bigint,
  p_bytes integer,
  p_sha256 text,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.quote_request_dropbox_files%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Website artwork updates are server-only'
      USING ERRCODE = '42501';
  END IF;

  IF p_bytes IS NULL OR p_bytes <= 0 OR p_bytes > 4194304 THEN
    RETURN jsonb_build_object('outcome', 'chunk_too_large');
  END IF;

  IF p_sha256 !~ '^[0-9a-f]{64}$' OR p_offset IS NULL OR p_offset < 0 THEN
    RETURN jsonb_build_object('outcome', 'invalid_chunk');
  END IF;

  SELECT *
  INTO v_row
  FROM public.quote_request_dropbox_files
  WHERE id = p_file_id
  FOR UPDATE;

  IF NOT FOUND OR v_row.quote_request_id IS DISTINCT FROM p_quote_request_id THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF v_row.upload_status = 'uploaded' THEN
    RETURN jsonb_build_object('outcome', 'already_uploaded');
  END IF;

  IF v_row.upload_status = 'failed' THEN
    RETURN jsonb_build_object('outcome', 'failed');
  END IF;

  IF v_row.session_expires_at IS NOT NULL AND v_row.session_expires_at <= p_now THEN
    UPDATE public.quote_request_dropbox_files
    SET
      upload_status = 'failed',
      dropbox_upload_session_id = NULL,
      append_claim_expires_at = NULL,
      append_claim_offset = NULL,
      append_claim_bytes = NULL,
      append_claim_kind = NULL
    WHERE id = p_file_id;
    RETURN jsonb_build_object('outcome', 'expired');
  END IF;

  IF v_row.dropbox_upload_session_id IS NULL THEN
    UPDATE public.quote_request_dropbox_files
    SET
      upload_status = 'failed',
      append_claim_expires_at = NULL,
      append_claim_offset = NULL,
      append_claim_bytes = NULL,
      append_claim_kind = NULL
    WHERE id = p_file_id;
    RETURN jsonb_build_object('outcome', 'no_session');
  END IF;

  IF v_row.last_accepted_offset IS NOT NULL
    AND p_offset = v_row.last_accepted_offset
    AND p_bytes = v_row.last_accepted_bytes
    AND p_sha256 = v_row.last_accepted_sha256
    AND v_row.upload_session_offset = p_offset + p_bytes THEN
    RETURN jsonb_build_object(
      'outcome', 'duplicate',
      'committedOffset', v_row.upload_session_offset
    );
  END IF;

  IF p_offset < v_row.upload_session_offset THEN
    RETURN jsonb_build_object(
      'outcome', 'conflict',
      'committedOffset', v_row.upload_session_offset
    );
  END IF;

  IF p_offset > v_row.upload_session_offset THEN
    RETURN jsonb_build_object(
      'outcome', 'gap',
      'committedOffset', v_row.upload_session_offset
    );
  END IF;

  IF v_row.file_size_bytes IS NULL OR p_offset + p_bytes > v_row.file_size_bytes THEN
    RETURN jsonb_build_object(
      'outcome', 'exceeds',
      'committedOffset', v_row.upload_session_offset
    );
  END IF;

  IF v_row.append_claim_expires_at IS NOT NULL AND v_row.append_claim_expires_at > p_now THEN
    RETURN jsonb_build_object(
      'outcome', 'busy',
      'committedOffset', v_row.upload_session_offset
    );
  END IF;

  UPDATE public.quote_request_dropbox_files
  SET
    append_claim_expires_at = p_now + interval '2 minutes',
    append_claim_offset = p_offset,
    append_claim_bytes = p_bytes,
    append_claim_kind = 'chunk'
  WHERE id = p_file_id;

  RETURN jsonb_build_object(
    'outcome', 'proceed',
    'sessionId', v_row.dropbox_upload_session_id,
    'committedOffset', v_row.upload_session_offset
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.quote_request_dropbox_commit_chunk(
  p_file_id uuid,
  p_quote_request_id uuid,
  p_offset bigint,
  p_bytes integer,
  p_sha256 text,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.quote_request_dropbox_files%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Website artwork updates are server-only'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_row
  FROM public.quote_request_dropbox_files
  WHERE id = p_file_id
    AND quote_request_id = p_quote_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF v_row.append_claim_kind IS DISTINCT FROM 'chunk'
    OR v_row.append_claim_offset IS DISTINCT FROM p_offset
    OR v_row.append_claim_bytes IS DISTINCT FROM p_bytes
    OR v_row.upload_session_offset IS DISTINCT FROM p_offset
    OR v_row.append_claim_expires_at IS NULL
    OR v_row.append_claim_expires_at <= p_now
    OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object(
      'outcome', 'lost_claim',
      'committedOffset', v_row.upload_session_offset
    );
  END IF;

  UPDATE public.quote_request_dropbox_files
  SET
    upload_session_offset = p_offset + p_bytes,
    last_accepted_offset = p_offset,
    last_accepted_bytes = p_bytes,
    last_accepted_sha256 = p_sha256,
    append_claim_expires_at = NULL,
    append_claim_offset = NULL,
    append_claim_bytes = NULL,
    append_claim_kind = NULL
  WHERE id = p_file_id;

  RETURN jsonb_build_object(
    'outcome', 'committed',
    'committedOffset', p_offset + p_bytes
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.quote_request_dropbox_release_claim(
  p_file_id uuid,
  p_quote_request_id uuid,
  p_kind text,
  p_offset bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Website artwork updates are server-only'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.quote_request_dropbox_files
  SET
    append_claim_expires_at = NULL,
    append_claim_offset = NULL,
    append_claim_bytes = NULL,
    append_claim_kind = NULL
  WHERE id = p_file_id
    AND quote_request_id = p_quote_request_id
    AND upload_status = 'pending'
    AND append_claim_kind = p_kind
    AND (
      p_kind = 'finish'
      OR append_claim_offset IS NOT DISTINCT FROM p_offset
    );

  RETURN jsonb_build_object('outcome', 'released');
END;
$$;

CREATE OR REPLACE FUNCTION public.quote_request_dropbox_claim_finish(
  p_file_id uuid,
  p_quote_request_id uuid,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.quote_request_dropbox_files%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Website artwork updates are server-only'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_row
  FROM public.quote_request_dropbox_files
  WHERE id = p_file_id
    AND quote_request_id = p_quote_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF v_row.upload_status = 'uploaded' THEN
    RETURN jsonb_build_object(
      'outcome', 'already',
      'dropboxFileId', v_row.dropbox_file_id,
      'dropboxPath', v_row.dropbox_path
    );
  END IF;

  IF v_row.upload_status = 'failed' THEN
    RETURN jsonb_build_object('outcome', 'failed');
  END IF;

  IF v_row.session_expires_at IS NOT NULL AND v_row.session_expires_at <= p_now THEN
    UPDATE public.quote_request_dropbox_files
    SET
      upload_status = 'failed',
      dropbox_upload_session_id = NULL,
      append_claim_expires_at = NULL,
      append_claim_offset = NULL,
      append_claim_bytes = NULL,
      append_claim_kind = NULL
    WHERE id = p_file_id;
    RETURN jsonb_build_object('outcome', 'expired');
  END IF;

  IF v_row.dropbox_upload_session_id IS NULL OR v_row.dropbox_path IS NULL THEN
    RETURN jsonb_build_object('outcome', 'no_session');
  END IF;

  IF v_row.upload_session_offset IS DISTINCT FROM v_row.file_size_bytes THEN
    RETURN jsonb_build_object(
      'outcome', 'incomplete',
      'committedOffset', v_row.upload_session_offset
    );
  END IF;

  IF v_row.append_claim_expires_at IS NOT NULL AND v_row.append_claim_expires_at > p_now THEN
    RETURN jsonb_build_object(
      'outcome', 'busy',
      'committedOffset', v_row.upload_session_offset
    );
  END IF;

  UPDATE public.quote_request_dropbox_files
  SET
    append_claim_expires_at = p_now + interval '2 minutes',
    append_claim_offset = NULL,
    append_claim_bytes = NULL,
    append_claim_kind = 'finish'
  WHERE id = p_file_id;

  RETURN jsonb_build_object(
    'outcome', 'proceed',
    'sessionId', v_row.dropbox_upload_session_id,
    'dropboxPath', v_row.dropbox_path,
    'totalBytes', v_row.file_size_bytes
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.quote_request_dropbox_complete_file(
  p_file_id uuid,
  p_quote_request_id uuid,
  p_dropbox_file_id text,
  p_dropbox_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.quote_request_dropbox_files%ROWTYPE;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Website artwork updates are server-only'
      USING ERRCODE = '42501';
  END IF;

  IF p_dropbox_file_id IS NULL
    OR btrim(p_dropbox_file_id) = ''
    OR p_dropbox_file_id ~* '^https?://'
    OR p_dropbox_path IS NULL
    OR btrim(p_dropbox_path) = ''
    OR p_dropbox_path ~* '^https?://'
    OR p_dropbox_path LIKE '%..%' THEN
    RETURN jsonb_build_object('outcome', 'invalid_path');
  END IF;

  SELECT *
  INTO v_row
  FROM public.quote_request_dropbox_files
  WHERE id = p_file_id
    AND quote_request_id = p_quote_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF v_row.upload_status = 'uploaded' THEN
    RETURN jsonb_build_object('outcome', 'already');
  END IF;

  IF v_row.upload_status IS DISTINCT FROM 'pending'
    OR v_row.append_claim_kind IS DISTINCT FROM 'finish' THEN
    RETURN jsonb_build_object('outcome', 'not_ready');
  END IF;

  UPDATE public.quote_request_dropbox_files
  SET
    upload_status = 'uploaded',
    dropbox_file_id = btrim(p_dropbox_file_id),
    dropbox_path = btrim(p_dropbox_path),
    dropbox_upload_session_id = NULL,
    append_claim_expires_at = NULL,
    append_claim_offset = NULL,
    append_claim_bytes = NULL,
    append_claim_kind = NULL
  WHERE id = p_file_id;

  RETURN jsonb_build_object('outcome', 'uploaded');
END;
$$;

CREATE OR REPLACE FUNCTION public.quote_request_dropbox_expire_enquiry(
  p_quote_request_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role'
    AND NOT public.is_candid_admin() THEN
    RAISE EXCEPTION 'Not allowed to update website artwork'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.quote_request_dropbox_files
  SET
    upload_status = 'failed',
    dropbox_upload_session_id = NULL,
    append_claim_expires_at = NULL,
    append_claim_offset = NULL,
    append_claim_bytes = NULL,
    append_claim_kind = NULL
  WHERE quote_request_id = p_quote_request_id
    AND upload_status = 'pending'
    AND (
      (session_expires_at IS NOT NULL AND session_expires_at <= p_now)
      OR (
        dropbox_upload_session_id IS NULL
        AND created_at <= p_now - interval '15 minutes'
      )
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('outcome', 'expired', 'count', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.quote_request_dropbox_suffixed_name(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quote_request_dropbox_reserve_file(uuid, text, text, text, text, bigint, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quote_request_dropbox_attach_session(uuid, uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quote_request_dropbox_fail_file(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quote_request_dropbox_claim_chunk(uuid, uuid, bigint, integer, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quote_request_dropbox_commit_chunk(uuid, uuid, bigint, integer, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quote_request_dropbox_release_claim(uuid, uuid, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quote_request_dropbox_claim_finish(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quote_request_dropbox_complete_file(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quote_request_dropbox_expire_enquiry(uuid, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.quote_request_dropbox_reserve_file(uuid, text, text, text, text, bigint, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.quote_request_dropbox_attach_session(uuid, uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.quote_request_dropbox_fail_file(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.quote_request_dropbox_claim_chunk(uuid, uuid, bigint, integer, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.quote_request_dropbox_commit_chunk(uuid, uuid, bigint, integer, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.quote_request_dropbox_release_claim(uuid, uuid, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.quote_request_dropbox_claim_finish(uuid, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.quote_request_dropbox_complete_file(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.quote_request_dropbox_expire_enquiry(uuid, timestamptz) TO service_role, authenticated;

COMMIT;
