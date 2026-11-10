-- Installation UX: storage-policy EXECUTE and snag details.
-- Test only. Does not drop installation projects, visits, or stored files.
--
-- Storage policies installation_files_select_reader and installation_files_insert_operator
-- are FOR authenticated and call installation_visit_exists, installation_storage_path_is_valid,
-- and installation_storage_visit_id_from_path. Those helpers were revoked from authenticated,
-- so photo and document uploads and downloads fail with
-- "permission denied for function installation_visit_exists".
-- The calling role is authenticated. The functions only confirm a visit id or a path shape.
-- EXECUTE is granted to authenticated only. Anon stays revoked. No table writes are granted.

BEGIN;

GRANT EXECUTE ON FUNCTION public.installation_visit_exists(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installation_storage_path_is_valid(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installation_storage_visit_id_from_path(text) TO authenticated;

-- Path checks were previously executable through PUBLIC. Keep that for the
-- service role after PUBLIC is revoked. installation_visit_exists stays limited
-- to authenticated, which is the role that evaluates the storage policies.
GRANT EXECUTE ON FUNCTION public.installation_storage_path_is_valid(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.installation_storage_visit_id_from_path(text) TO service_role;

REVOKE ALL ON FUNCTION public.installation_visit_exists(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.installation_storage_path_is_valid(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.installation_storage_visit_id_from_path(text) FROM PUBLIC, anon;

ALTER TABLE public.installation_snag_items
  DROP CONSTRAINT IF EXISTS installation_snag_items_status_check;

ALTER TABLE public.installation_snag_items
  ADD CONSTRAINT installation_snag_items_status_check
  CHECK (status IN ('open', 'in_progress', 'resolved', 'wont_fix'));

ALTER TABLE public.installation_snag_items
  ADD COLUMN IF NOT EXISTS assigned_to_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.installation_visit_photos
  ADD COLUMN IF NOT EXISTS snag_id uuid REFERENCES public.installation_snag_items(id) ON DELETE SET NULL;

ALTER TABLE public.installation_visit_photos
  ADD COLUMN IF NOT EXISTS snag_photo_role text;

ALTER TABLE public.installation_visit_photos
  DROP CONSTRAINT IF EXISTS installation_visit_photos_snag_role_check;

ALTER TABLE public.installation_visit_photos
  ADD CONSTRAINT installation_visit_photos_snag_role_check
  CHECK (
    (snag_id IS NULL AND snag_photo_role IS NULL)
    OR (snag_id IS NOT NULL AND snag_photo_role IN ('issue', 'resolution'))
  );

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
      'snag_updated',
      'snag_resolved',
      'sign_off_captured',
      'document_added',
      'photo_added',
      'note_added',
      'visit_reopened'
    )
  );

DROP FUNCTION IF EXISTS public.installation_snag_upsert(uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.installation_snag_upsert(uuid, uuid, text, text, text, uuid);

CREATE FUNCTION public.installation_snag_upsert(
  p_visit_id uuid,
  p_snag_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_resolution_notes text DEFAULT NULL,
  p_assigned_profile_id uuid DEFAULT NULL
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

  IF p_status IS NOT NULL AND p_status NOT IN ('open', 'in_progress', 'resolved', 'wont_fix') THEN
    RAISE EXCEPTION 'Invalid snag status.';
  END IF;

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
      reported_by_profile_id,
      assigned_to_profile_id
    )
    VALUES (
      p_visit_id,
      btrim(p_description),
      'open',
      auth.uid(),
      p_assigned_profile_id
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
    description = CASE
      WHEN p_description IS NULL OR btrim(p_description) = '' THEN description
      ELSE btrim(p_description)
    END,
    status = coalesce(p_status, status),
    resolution_notes = coalesce(p_resolution_notes, resolution_notes),
    assigned_to_profile_id = coalesce(p_assigned_profile_id, assigned_to_profile_id),
    resolved_by_profile_id = CASE
      WHEN coalesce(p_status, status) IN ('resolved', 'wont_fix') THEN auth.uid()
      WHEN p_status IN ('open', 'in_progress') THEN NULL
      ELSE resolved_by_profile_id
    END,
    resolved_at = CASE
      WHEN coalesce(p_status, status) IN ('resolved', 'wont_fix') THEN coalesce(resolved_at, now())
      WHEN p_status IN ('open', 'in_progress') THEN NULL
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
    CASE
      WHEN v_status IN ('resolved', 'wont_fix') THEN 'snag_resolved'
      ELSE 'snag_updated'
    END,
    jsonb_build_object('snag_id', p_snag_id, 'status', v_status)
  );

  RETURN p_snag_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.installation_register_snag_photo(
  p_visit_id uuid,
  p_snag_id uuid,
  p_role text,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_byte_size integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_path_visit uuid;
  v_phase text;
BEGIN
  PERFORM public.installation_assert_operator();

  IF p_role NOT IN ('issue', 'resolution') THEN
    RAISE EXCEPTION 'Snag photo role must be issue or resolution.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.installation_snag_items
    WHERE id = p_snag_id
      AND installation_visit_id = p_visit_id
  ) THEN
    RAISE EXCEPTION 'Snag not found for visit.';
  END IF;

  v_path_visit := public.installation_storage_visit_id_from_path(p_storage_path);
  IF v_path_visit IS NULL OR v_path_visit IS DISTINCT FROM p_visit_id THEN
    RAISE EXCEPTION 'Storage path must begin with the visit id.';
  END IF;

  IF NOT public.installation_storage_path_is_valid(p_storage_path) THEN
    RAISE EXCEPTION 'Invalid installation photo storage path.';
  END IF;

  v_phase := split_part(p_storage_path, '/', 3);
  IF v_phase NOT IN ('before', 'during', 'after') THEN
    RAISE EXCEPTION 'Invalid installation photo storage path.';
  END IF;

  INSERT INTO public.installation_visit_photos (
    installation_visit_id,
    phase,
    storage_path,
    file_name,
    mime_type,
    byte_size,
    captured_at,
    uploaded_by_profile_id,
    snag_id,
    snag_photo_role
  )
  VALUES (
    p_visit_id,
    v_phase,
    p_storage_path,
    p_file_name,
    p_mime_type,
    p_byte_size,
    now(),
    auth.uid(),
    p_snag_id,
    p_role
  )
  RETURNING id INTO v_id;

  PERFORM public.installation_append_visit_event(
    p_visit_id,
    'photo_added',
    jsonb_build_object('photo_id', v_id, 'snag_id', p_snag_id, 'role', p_role)
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.installation_snag_upsert(uuid, uuid, text, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.installation_register_snag_photo(uuid, uuid, text, text, text, text, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.installation_snag_upsert(uuid, uuid, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installation_register_snag_photo(uuid, uuid, text, text, text, text, integer) TO authenticated;

COMMIT;
