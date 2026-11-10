-- Installation Management Phase 1 — full hardening REPAIR (Test).
-- Re-applies the complete delta from 20270110164000 when that migration did not
-- persist (partial SQL Editor run or rolled-back transaction). Requires 163000 applied.
-- Supabase SQL Editor: paste this entire file and Run once (plain SQL only — no psql
-- meta-commands). Safe to run once on Test; idempotent CREATE OR REPLACE / DROP POLICY.
-- Does not DROP tables or mutate existing installation rows.
-- After success:
--   NOTIFY pgrst, 'reload schema';
-- Post-apply checks: scripts/verify-installation-phase1-hardening-repair.sql
-- Project: axhkdwgmwhlbsstumndh only. DO NOT run on Live. DO NOT re-run 163000/164000.
-- If GRANT failed with 42883: function was not in pg_proc (CREATE failed/skipped or
-- transaction rolled back). Pre-GRANT DO block surfaces CREATE failures explicitly.

BEGIN;

-- ---------------------------------------------------------------------------
-- Storage path validation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.installation_storage_visit_id_from_path(p_path text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT public.storage_installation_visit_id_from_path(p_path);
$$;

CREATE OR REPLACE FUNCTION public.installation_storage_path_is_valid(p_path text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    public.installation_storage_visit_id_from_path(p_path) IS NOT NULL
    AND split_part(p_path, '/', 2) IN ('documents', 'photos')
    AND (
      split_part(p_path, '/', 2) <> 'documents'
      OR split_part(p_path, '/', 3) IN (
        'rams',
        'artwork',
        'drawing',
        'installation_instructions',
        'other'
      )
    )
    AND (
      split_part(p_path, '/', 2) <> 'photos'
      OR split_part(p_path, '/', 3) IN ('before', 'during', 'after')
    );
$$;

CREATE OR REPLACE FUNCTION public.installation_visit_exists(p_visit_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.installation_visits v
    WHERE v.id = p_visit_id
  );
$$;

REVOKE ALL ON FUNCTION public.installation_visit_exists(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage policies (replace — visit must exist, path must be valid)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS installation_files_select_reader ON storage.objects;
CREATE POLICY installation_files_select_reader
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'installation-files'
    AND public.is_approved_installation_reader()
    AND public.installation_storage_path_is_valid(name)
    AND public.installation_visit_exists(
      public.installation_storage_visit_id_from_path(name)
    )
  );

DROP POLICY IF EXISTS installation_files_insert_operator ON storage.objects;
CREATE POLICY installation_files_insert_operator
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'installation-files'
    AND public.is_approved_installation_operator()
    AND public.installation_storage_path_is_valid(name)
    AND public.installation_visit_exists(
      public.installation_storage_visit_id_from_path(name)
    )
  );

-- ---------------------------------------------------------------------------
-- Metadata RPCs: path must match visit id
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.installation_register_visit_document(
  p_visit_id uuid,
  p_document_kind text,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_byte_size integer,
  p_linked_job_file_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_path_visit uuid;
BEGIN
  PERFORM public.installation_assert_operator();

  v_path_visit := public.installation_storage_visit_id_from_path(p_storage_path);
  IF v_path_visit IS NULL OR v_path_visit IS DISTINCT FROM p_visit_id THEN
    RAISE EXCEPTION 'Storage path must begin with the visit id.';
  END IF;

  IF NOT public.installation_storage_path_is_valid(p_storage_path) THEN
    RAISE EXCEPTION 'Invalid installation document storage path.';
  END IF;

  INSERT INTO public.installation_visit_documents (
    installation_visit_id,
    document_kind,
    storage_path,
    linked_job_file_id,
    file_name,
    mime_type,
    byte_size,
    uploaded_by_profile_id
  )
  VALUES (
    p_visit_id,
    p_document_kind,
    p_storage_path,
    p_linked_job_file_id,
    p_file_name,
    p_mime_type,
    p_byte_size,
    auth.uid()
  )
  RETURNING id INTO v_id;

  PERFORM public.installation_append_visit_event(
    p_visit_id,
    'document_added',
    jsonb_build_object('document_id', v_id, 'document_kind', p_document_kind)
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.installation_register_visit_photo(
  p_visit_id uuid,
  p_phase text,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_byte_size integer,
  p_captured_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_path_visit uuid;
BEGIN
  PERFORM public.installation_assert_operator();

  v_path_visit := public.installation_storage_visit_id_from_path(p_storage_path);
  IF v_path_visit IS NULL OR v_path_visit IS DISTINCT FROM p_visit_id THEN
    RAISE EXCEPTION 'Storage path must begin with the visit id.';
  END IF;

  IF NOT public.installation_storage_path_is_valid(p_storage_path) THEN
    RAISE EXCEPTION 'Invalid installation photo storage path.';
  END IF;

  IF split_part(p_storage_path, '/', 3) IS DISTINCT FROM p_phase THEN
    RAISE EXCEPTION 'Photo path phase must match requested phase.';
  END IF;

  INSERT INTO public.installation_visit_photos (
    installation_visit_id,
    phase,
    storage_path,
    file_name,
    mime_type,
    byte_size,
    captured_at,
    uploaded_by_profile_id
  )
  VALUES (
    p_visit_id,
    p_phase,
    p_storage_path,
    p_file_name,
    p_mime_type,
    p_byte_size,
    coalesce(p_captured_at, now()),
    auth.uid()
  )
  RETURNING id INTO v_id;

  PERFORM public.installation_append_visit_event(
    p_visit_id,
    'photo_added',
    jsonb_build_object('photo_id', v_id, 'phase', p_phase)
  );

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Terminal visit protection + manager reopen
-- ---------------------------------------------------------------------------

ALTER TABLE public.installation_visit_events
  DROP CONSTRAINT IF EXISTS installation_visit_events_type_check;

ALTER TABLE public.installation_visit_events
  ADD CONSTRAINT installation_visit_events_type_check
  CHECK (
    event_type IN (
      'status_changed',
      'scheduled',
      'assignment_added',
      'assignment_removed',
      'completed',
      'snag_opened',
      'snag_resolved',
      'sign_off_captured',
      'document_added',
      'photo_added',
      'note_added',
      'visit_reopened'
    )
  );

CREATE OR REPLACE FUNCTION public.installation_visit_operational_progress(
  p_visit_id uuid,
  p_status text DEFAULT NULL,
  p_actual_start_at timestamptz DEFAULT NULL,
  p_actual_end_at timestamptz DEFAULT NULL,
  p_internal_notes text DEFAULT NULL,
  p_completion_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_status text;
BEGIN
  PERFORM public.installation_assert_operator();

  IF p_status IS NOT NULL AND p_status IN ('unscheduled', 'scheduled', 'cancelled') THEN
    RAISE EXCEPTION 'Installers cannot set administrative visit statuses.';
  END IF;

  SELECT status INTO v_prev_status
  FROM public.installation_visits
  WHERE id = p_visit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visit not found.';
  END IF;

  IF v_prev_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Completed or cancelled visits cannot be changed by operators. Use manager reopen.';
  END IF;

  UPDATE public.installation_visits
  SET
    status = coalesce(p_status, status),
    actual_start_at = coalesce(p_actual_start_at, actual_start_at),
    actual_end_at = coalesce(p_actual_end_at, actual_end_at),
    internal_notes = coalesce(p_internal_notes, internal_notes),
    completion_notes = coalesce(p_completion_notes, completion_notes),
    completed_at = CASE
      WHEN coalesce(p_status, status) = 'completed' THEN coalesce(completed_at, now())
      ELSE completed_at
    END,
    completed_by_profile_id = CASE
      WHEN coalesce(p_status, status) = 'completed' THEN coalesce(completed_by_profile_id, auth.uid())
      ELSE completed_by_profile_id
    END
  WHERE id = p_visit_id;

  IF p_status IS NOT NULL AND p_status IS DISTINCT FROM v_prev_status THEN
    PERFORM public.installation_append_visit_event(
      p_visit_id,
      CASE WHEN p_status = 'completed' THEN 'completed' ELSE 'status_changed' END,
      jsonb_build_object('previous_status', v_prev_status, 'new_status', p_status)
    );
  ELSIF p_internal_notes IS NOT NULL OR p_completion_notes IS NOT NULL THEN
    PERFORM public.installation_append_visit_event(
      p_visit_id,
      'note_added',
      '{}'::jsonb
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.installation_visit_manager_reopen(
  p_visit_id uuid,
  p_reason text,
  p_target_status text DEFAULT 'scheduled'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_status text;
BEGIN
  PERFORM public.installation_assert_manager();

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Reopen reason is required.';
  END IF;

  IF p_target_status NOT IN ('unscheduled', 'scheduled') THEN
    RAISE EXCEPTION 'Reopen target status must be unscheduled or scheduled.';
  END IF;

  SELECT status INTO v_prev_status
  FROM public.installation_visits
  WHERE id = p_visit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visit not found.';
  END IF;

  IF v_prev_status NOT IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Only completed or cancelled visits can be reopened.';
  END IF;

  UPDATE public.installation_visits
  SET
    status = p_target_status,
    completed_at = NULL,
    completed_by_profile_id = NULL
  WHERE id = p_visit_id;

  PERFORM public.installation_append_visit_event(
    p_visit_id,
    'visit_reopened',
    jsonb_build_object(
      'previous_status', v_prev_status,
      'new_status', p_target_status,
      'reason', btrim(p_reason)
    )
  );
END;
$$;

DO $precheck$
BEGIN
  IF to_regprocedure('public.installation_visit_manager_reopen(uuid, text, text)') IS NULL THEN
    RAISE EXCEPTION
      'installation_visit_manager_reopen was not created; fix CREATE errors above before GRANT';
  END IF;
END;
$precheck$;

GRANT EXECUTE ON FUNCTION public.installation_visit_manager_reopen(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.installation_snag_upsert(
  p_visit_id uuid,
  p_snag_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_resolution_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snag_id uuid;
  v_status text;
  v_visit_status text;
BEGIN
  PERFORM public.installation_assert_operator();

  SELECT status INTO v_visit_status
  FROM public.installation_visits
  WHERE id = p_visit_id;

  IF v_visit_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot modify snagging on completed or cancelled visits.';
  END IF;

  IF p_snag_id IS NULL THEN
    IF p_description IS NULL OR btrim(p_description) = '' THEN
      RAISE EXCEPTION 'Snag description is required.';
    END IF;

    INSERT INTO public.installation_snag_items (
      installation_visit_id,
      description,
      status,
      reported_by_profile_id
    )
    VALUES (
      p_visit_id,
      btrim(p_description),
      'open',
      auth.uid()
    )
    RETURNING id INTO v_snag_id;

    PERFORM public.installation_append_visit_event(
      p_visit_id,
      'snag_opened',
      jsonb_build_object('snag_id', v_snag_id)
    );

    RETURN v_snag_id;
  END IF;

  UPDATE public.installation_snag_items
  SET
    status = coalesce(p_status, status),
    resolution_notes = coalesce(p_resolution_notes, resolution_notes),
    resolved_by_profile_id = CASE
      WHEN coalesce(p_status, status) IN ('resolved', 'wont_fix') THEN auth.uid()
      ELSE resolved_by_profile_id
    END,
    resolved_at = CASE
      WHEN coalesce(p_status, status) IN ('resolved', 'wont_fix') THEN coalesce(resolved_at, now())
      ELSE resolved_at
    END
  WHERE id = p_snag_id
    AND installation_visit_id = p_visit_id
  RETURNING status INTO v_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Snag not found for visit.';
  END IF;

  PERFORM public.installation_append_visit_event(
    p_visit_id,
    'snag_resolved',
    jsonb_build_object('snag_id', p_snag_id, 'status', v_status)
  );

  RETURN p_snag_id;
END;
$$;

COMMIT;
