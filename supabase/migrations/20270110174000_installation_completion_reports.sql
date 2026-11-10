-- Installation completion report versions.
-- Test only. Does not change visits, photos, signatures, quotes, jobs, or invoices.
-- Managers generate reports. Production, sales, customers, and accounts cannot.
-- Previous versions are append-only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.installation_completion_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_visit_id uuid NOT NULL REFERENCES public.installation_visits (id),
  installation_project_id uuid NOT NULL REFERENCES public.installation_projects (id),
  report_reference text NOT NULL,
  version_number integer NOT NULL,
  storage_path text NOT NULL,
  byte_size integer NOT NULL,
  included_photo_ids uuid[] NOT NULL DEFAULT '{}',
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by_profile_id uuid NOT NULL,
  CONSTRAINT installation_completion_reports_version_positive CHECK (version_number > 0),
  CONSTRAINT installation_completion_reports_byte_size_positive CHECK (byte_size > 0),
  CONSTRAINT installation_completion_reports_reference_not_blank CHECK (btrim(report_reference) <> ''),
  CONSTRAINT installation_completion_reports_visit_version_key UNIQUE (installation_visit_id, version_number),
  CONSTRAINT installation_completion_reports_storage_path_key UNIQUE (storage_path)
);

CREATE INDEX IF NOT EXISTS installation_completion_reports_project_idx
  ON public.installation_completion_reports (installation_project_id, generated_at DESC);

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
      'visit_reopened',
      'report_generated'
    )
  );

CREATE OR REPLACE FUNCTION public.installation_report_storage_path_is_valid(p_path text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    public.installation_storage_visit_id_from_path(p_path) IS NOT NULL
    AND split_part(p_path, '/', 2) = 'reports'
    AND split_part(p_path, '/', 3) ~ '^v[1-9][0-9]*$'
    AND split_part(p_path, '/', 4) ~ '^[A-Za-z0-9._-]+\.pdf$'
    AND split_part(p_path, '/', 5) = '';
$$;

REVOKE ALL ON FUNCTION public.installation_report_storage_path_is_valid(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.installation_report_storage_path_is_valid(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.installation_completion_report_reference(
  p_job_reference text,
  p_visit_number integer,
  p_version integer
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    'ICR-'
    || coalesce(nullif(regexp_replace(coalesce(p_job_reference, ''), '[^A-Za-z0-9-]+', '', 'g'), ''), 'VISIT')
    || '-V'
    || p_visit_number::text
    || '.'
    || p_version::text;
$$;

REVOKE ALL ON FUNCTION public.installation_completion_report_reference(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.installation_completion_report_reference(text, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.installation_completion_report_next(p_visit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visit_number integer;
  v_job_reference text;
  v_version integer;
BEGIN
  PERFORM public.installation_assert_manager();

  SELECT v.visit_number, j.job_reference
  INTO v_visit_number, v_job_reference
  FROM public.installation_visits v
  JOIN public.installation_projects p ON p.id = v.installation_project_id
  LEFT JOIN public.jobs j ON j.id = p.job_id
  WHERE v.id = p_visit_id;

  IF v_visit_number IS NULL THEN
    RAISE EXCEPTION 'Installation visit not found.';
  END IF;

  SELECT coalesce(max(version_number), 0) + 1
  INTO v_version
  FROM public.installation_completion_reports
  WHERE installation_visit_id = p_visit_id;

  RETURN jsonb_build_object(
    'version_number', v_version,
    'report_reference', public.installation_completion_report_reference(v_job_reference, v_visit_number, v_version)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.installation_completion_report_next(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.installation_completion_report_next(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.installation_register_completion_report(
  p_visit_id uuid,
  p_storage_path text,
  p_byte_size integer,
  p_included_photo_ids uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_visit_number integer;
  v_job_reference text;
  v_version integer;
  v_reference text;
  v_id uuid;
  v_photo_id uuid;
BEGIN
  PERFORM public.installation_assert_manager();

  IF p_byte_size IS NULL OR p_byte_size <= 0 THEN
    RAISE EXCEPTION 'Report file is empty.';
  END IF;

  IF NOT public.installation_report_storage_path_is_valid(p_storage_path)
    OR public.installation_storage_visit_id_from_path(p_storage_path) IS DISTINCT FROM p_visit_id
  THEN
    RAISE EXCEPTION 'Invalid installation report storage path.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('installation-completion-report'), hashtext(p_visit_id::text));

  SELECT v.installation_project_id, v.visit_number, j.job_reference
  INTO v_project_id, v_visit_number, v_job_reference
  FROM public.installation_visits v
  JOIN public.installation_projects p ON p.id = v.installation_project_id
  LEFT JOIN public.jobs j ON j.id = p.job_id
  WHERE v.id = p_visit_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Installation visit not found.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.installation_sign_offs s
    WHERE s.installation_visit_id = p_visit_id
      AND s.checklist IS NOT NULL
      AND COALESCE(s.checklist->>'site_left_safe_and_tidy', '') = 'true'
      AND COALESCE(s.checklist->>'installation_photos_recorded', '') = 'true'
      AND (
        (
          s.customer_attendance = 'present'
          AND btrim(s.customer_name) <> ''
          AND s.signature_storage_path IS NOT NULL
          AND public.installation_storage_path_is_valid(s.signature_storage_path)
          AND public.installation_storage_visit_id_from_path(s.signature_storage_path) = p_visit_id
        )
        OR (
          s.customer_attendance = 'absent'
          AND s.signature_storage_path IS NULL
        )
        OR (
          s.customer_attendance = 'declined'
          AND btrim(coalesce(s.decline_reason, '')) <> ''
          AND s.signature_storage_path IS NULL
        )
      )
  ) THEN
    RAISE EXCEPTION 'Record the visit sign-off before saving the completion report.';
  END IF;

  SELECT coalesce(max(version_number), 0) + 1
  INTO v_version
  FROM public.installation_completion_reports
  WHERE installation_visit_id = p_visit_id;

  IF split_part(p_storage_path, '/', 3) IS DISTINCT FROM 'v' || v_version::text THEN
    RAISE EXCEPTION 'Report version changed. Generate the report again.';
  END IF;

  FOREACH v_photo_id IN ARRAY coalesce(p_included_photo_ids, '{}'::uuid[])
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.installation_visit_photos
      WHERE id = v_photo_id
        AND installation_visit_id = p_visit_id
        AND snag_id IS NULL
    ) THEN
      RAISE EXCEPTION 'Selected photograph is not part of this visit.';
    END IF;
  END LOOP;

  v_reference := public.installation_completion_report_reference(v_job_reference, v_visit_number, v_version);

  INSERT INTO public.installation_completion_reports (
    installation_visit_id,
    installation_project_id,
    report_reference,
    version_number,
    storage_path,
    byte_size,
    included_photo_ids,
    generated_by_profile_id
  )
  VALUES (
    p_visit_id,
    v_project_id,
    v_reference,
    v_version,
    p_storage_path,
    p_byte_size,
    coalesce(p_included_photo_ids, '{}'::uuid[]),
    auth.uid()
  )
  RETURNING id INTO v_id;

  PERFORM public.installation_append_visit_event(
    p_visit_id,
    'report_generated',
    jsonb_build_object(
      'report_id', v_id,
      'report_reference', v_reference,
      'version_number', v_version
    )
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.installation_register_completion_report(uuid, text, integer, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.installation_register_completion_report(uuid, text, integer, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.installation_completion_reports_prevent_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Installation completion reports are append-only.';
END;
$$;

DROP TRIGGER IF EXISTS installation_completion_reports_immutable ON public.installation_completion_reports;
CREATE TRIGGER installation_completion_reports_immutable
  BEFORE UPDATE OR DELETE ON public.installation_completion_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.installation_completion_reports_prevent_mutation();

DROP TRIGGER IF EXISTS installation_completion_reports_block_client ON public.installation_completion_reports;
CREATE TRIGGER installation_completion_reports_block_client
  BEFORE INSERT OR UPDATE OR DELETE ON public.installation_completion_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.installation_block_client_table_writes();

ALTER TABLE public.installation_completion_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS installation_completion_reports_select_manager ON public.installation_completion_reports;
CREATE POLICY installation_completion_reports_select_manager
  ON public.installation_completion_reports FOR SELECT TO authenticated
  USING (public.is_approved_installation_manager());

GRANT SELECT ON TABLE public.installation_completion_reports TO authenticated, service_role;

DROP POLICY IF EXISTS installation_files_insert_report_manager ON storage.objects;
CREATE POLICY installation_files_insert_report_manager
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'installation-files'
    AND public.is_approved_installation_manager()
    AND public.installation_report_storage_path_is_valid(name)
  );

DROP POLICY IF EXISTS installation_files_select_report_manager ON storage.objects;
CREATE POLICY installation_files_select_report_manager
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'installation-files'
    AND public.is_approved_installation_manager()
    AND public.installation_report_storage_path_is_valid(name)
  );

DROP POLICY IF EXISTS installation_files_delete_manager ON storage.objects;
CREATE POLICY installation_files_delete_manager
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'installation-files'
    AND public.is_approved_installation_manager()
    AND NOT EXISTS (
      SELECT 1
      FROM public.installation_sign_offs
      WHERE signature_storage_path = name
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.installation_completion_reports
      WHERE storage_path = name
    )
  );

COMMIT;
