-- Installation Phase 2: explicit line classification and acceptance reconcile.
-- Does not backfill historical quote lines or previously accepted versions.
-- Apply on Test only, after 20270110167000. Then NOTIFY pgrst, 'reload schema';

BEGIN;

ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS work_class text,
  ADD COLUMN IF NOT EXISTS work_class_overridden boolean NOT NULL DEFAULT false;

ALTER TABLE public.quote_items
  DROP CONSTRAINT IF EXISTS quote_items_work_class_check;

ALTER TABLE public.quote_items
  ADD CONSTRAINT quote_items_work_class_check
  CHECK (
    work_class IS NULL
    OR work_class IN ('print_supply', 'delivery', 'installation')
  );

ALTER TABLE public.quote_versions
  ADD COLUMN IF NOT EXISTS installation_auto_reconcile boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS installation_reconcile_status text,
  ADD COLUMN IF NOT EXISTS installation_reconcile_error text,
  ADD COLUMN IF NOT EXISTS installation_reconciled_at timestamptz;

ALTER TABLE public.quote_versions
  DROP CONSTRAINT IF EXISTS quote_versions_installation_reconcile_status_check;

ALTER TABLE public.quote_versions
  ADD CONSTRAINT quote_versions_installation_reconcile_status_check
  CHECK (
    installation_reconcile_status IS NULL
    OR installation_reconcile_status IN ('succeeded', 'failed', 'skipped')
  );

CREATE OR REPLACE FUNCTION public.installation_version_requires_project(p_quote_version_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.quote_items qi
    WHERE qi.quote_version_id = p_quote_version_id
      AND public.installation_quote_item_in_version(qi)
      AND qi.work_class = 'installation'
  );
$$;

REVOKE ALL ON FUNCTION public.installation_version_requires_project(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.installation_reconcile_job_core(
  p_job_id uuid,
  p_actor uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_project_id uuid;
  v_created_project boolean := false;
  v_created_visit boolean := false;
  v_visit_count integer;
  v_requires boolean;
BEGIN
  SELECT * INTO v_job
  FROM public.jobs j
  WHERE j.id = p_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found.';
  END IF;

  IF v_job.quote_version_id IS NULL THEN
    RETURN jsonb_build_object(
      'job_id', p_job_id,
      'project_id', null,
      'created_project', false,
      'created_initial_visit', false,
      'skipped_reason', 'Job has no quote version.'
    );
  END IF;

  v_requires := public.installation_version_requires_project(v_job.quote_version_id);

  SELECT id INTO v_project_id
  FROM public.installation_projects ip
  WHERE ip.job_id = p_job_id;

  IF NOT v_requires THEN
    RETURN jsonb_build_object(
      'job_id', p_job_id,
      'project_id', v_project_id,
      'created_project', false,
      'created_initial_visit', false,
      'skipped_reason', 'No installation work detected on accepted quote version.'
    );
  END IF;

  IF v_project_id IS NULL THEN
    INSERT INTO public.installation_projects (
      company_id,
      job_id,
      quote_id,
      quote_version_id,
      title,
      source,
      status,
      created_by
    )
    VALUES (
      v_job.company_id,
      v_job.id,
      v_job.quote_id,
      v_job.quote_version_id,
      coalesce(nullif(btrim(v_job.project_name), ''), 'Installation — ' || v_job.job_reference),
      'quote_reconcile',
      'active',
      p_actor
    )
    RETURNING id INTO v_project_id;

    v_created_project := true;
  END IF;

  SELECT count(*)::integer INTO v_visit_count
  FROM public.installation_visits iv
  WHERE iv.installation_project_id = v_project_id;

  IF v_visit_count = 0 THEN
    INSERT INTO public.installation_visits (
      installation_project_id,
      visit_number,
      title,
      purpose,
      status,
      created_by
    )
    VALUES (
      v_project_id,
      1,
      'Initial site visit',
      'quote_reconcile',
      'unscheduled',
      p_actor
    );

    v_created_visit := true;

    PERFORM public.installation_append_visit_event(
      (
        SELECT id
        FROM public.installation_visits
        WHERE installation_project_id = v_project_id
          AND visit_number = 1
      ),
      'status_changed',
      jsonb_build_object('status', 'unscheduled', 'source', 'quote_reconcile')
    );
  END IF;

  RETURN jsonb_build_object(
    'job_id', p_job_id,
    'project_id', v_project_id,
    'created_project', v_created_project,
    'created_initial_visit', v_created_visit,
    'skipped_reason', null
  );
END;
$$;

REVOKE ALL ON FUNCTION public.installation_reconcile_job_core(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.installation_reconcile_for_job(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.installation_assert_manager();
  RETURN public.installation_reconcile_job_core(p_job_id, auth.uid());
END;
$$;

GRANT EXECUTE ON FUNCTION public.installation_reconcile_for_job(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.installation_reconcile_accepted_job(
  p_job_id uuid,
  p_actor uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_auto boolean;
  v_version_status text;
  v_role text;
BEGIN
  v_role := nullif(current_setting('request.jwt.claim.role', true), '');

  IF v_role IS NULL AND nullif(current_setting('request.jwt.claims', true), '') IS NOT NULL THEN
    BEGIN
      v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
    EXCEPTION
      WHEN others THEN
        v_role := NULL;
    END;
  END IF;

  IF coalesce(auth.role(), v_role) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Forbidden.';
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found.';
  END IF;

  IF v_job.quote_version_id IS NULL THEN
    RETURN jsonb_build_object(
      'job_id', p_job_id,
      'project_id', null,
      'created_project', false,
      'created_initial_visit', false,
      'skipped_reason', 'Job has no quote version.'
    );
  END IF;

  SELECT version_status, installation_auto_reconcile
  INTO v_version_status, v_auto
  FROM public.quote_versions
  WHERE id = v_job.quote_version_id;

  IF v_version_status IS DISTINCT FROM 'accepted' OR v_auto IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'job_id', p_job_id,
      'project_id', null,
      'created_project', false,
      'created_initial_visit', false,
      'skipped_reason', 'Not a phase 2 acceptance.'
    );
  END IF;

  RETURN public.installation_reconcile_job_core(p_job_id, p_actor);
END;
$$;

REVOKE ALL ON FUNCTION public.installation_reconcile_accepted_job(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.installation_reconcile_accepted_job(uuid, uuid) TO service_role;

COMMIT;
