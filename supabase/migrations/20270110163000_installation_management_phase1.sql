-- Installation Management — Phase 1 foundation (Test).
-- Supabase SQL Editor: paste this entire file and Run once (plain SQL only — no psql
-- meta-commands such as \set, \i, or :variable substitutions). After success:
--   NOTIFY pgrst, 'reload schema';
-- Apply manually on candid-os-test (axhkdwgmwhlbsstumndh) only. DO NOT run automatically.

BEGIN;

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.installation_block_direct_client_write()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT session_user IN ('authenticated', 'anon')
    AND current_user IN ('authenticated', 'anon');
$$;

REVOKE ALL ON FUNCTION public.installation_block_direct_client_write() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.is_approved_installation_reader()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.account_status = 'approved'
      AND p.user_role IN ('super_admin', 'admin', 'sales', 'production')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_approved_installation_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_approved_candid_admin();
$$;

CREATE OR REPLACE FUNCTION public.is_approved_installation_operator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.account_status = 'approved'
      AND p.user_role IN ('super_admin', 'admin', 'production')
  );
$$;

CREATE OR REPLACE FUNCTION public.installation_assert_reader()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_installation_reader() THEN
    RAISE EXCEPTION 'Forbidden.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.installation_assert_manager()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_installation_manager() THEN
    RAISE EXCEPTION 'Forbidden.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.installation_assert_operator()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_installation_operator() THEN
    RAISE EXCEPTION 'Forbidden.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.is_approved_installation_reader() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_approved_installation_manager() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_approved_installation_operator() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.installation_assert_reader() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.installation_assert_manager() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.installation_assert_operator() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Detection helpers (quote reconcile)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.installation_is_delivery_only_line(p_title text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    btrim(lower(coalesce(p_title, ''))) LIKE '%delivery%'
    AND btrim(lower(coalesce(p_title, ''))) NOT LIKE '%installation%'
    AND btrim(lower(coalesce(p_title, ''))) NOT LIKE '%install%'
    AND btrim(lower(coalesce(p_title, ''))) NOT LIKE '%site visit%';
$$;

CREATE OR REPLACE FUNCTION public.installation_quote_line_qualifies(p_title text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    NOT public.installation_is_delivery_only_line(p_title)
    AND (
      btrim(lower(coalesce(p_title, ''))) LIKE '%installation%'
      OR btrim(lower(coalesce(p_title, ''))) LIKE '%install%'
      OR btrim(lower(coalesce(p_title, ''))) LIKE '%site visit%'
    );
$$;

CREATE OR REPLACE FUNCTION public.installation_quote_item_in_version(p_item public.quote_items)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
  CASE
    WHEN p_item.is_optional IS NOT TRUE THEN true
    ELSE p_item.is_selected IS TRUE
  END;
$$;

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
      AND public.installation_quote_line_qualifies(qi.title)
  )
  OR EXISTS (
    SELECT 1
    FROM public.quote_items qi
    JOIN public.quote_item_costs qic
      ON qic.quote_item_id = qi.id
    JOIN public.quote_item_cost_components cc
      ON cc.quote_item_cost_id = qic.id
    WHERE qi.quote_version_id = p_quote_version_id
      AND public.installation_quote_item_in_version(qi)
      AND cc.component_type = 'installation'
      AND NOT public.installation_is_delivery_only_line(qi.title)
  );
$$;

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.installation_projects (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  job_id              uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  quote_id            uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  quote_version_id    uuid REFERENCES public.quote_versions(id) ON DELETE SET NULL,
  title               text NOT NULL,
  description         text,
  source              text NOT NULL,
  status              text NOT NULL DEFAULT 'active',
  created_by          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT installation_projects_title_not_blank
    CHECK (btrim(title) <> ''),
  CONSTRAINT installation_projects_source_check
    CHECK (source IN ('manual', 'quote_reconcile')),
  CONSTRAINT installation_projects_status_check
    CHECK (status IN ('draft', 'active', 'completed', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS installation_projects_job_id_unique_idx
  ON public.installation_projects (job_id)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS installation_projects_company_idx
  ON public.installation_projects (company_id);

CREATE INDEX IF NOT EXISTS installation_projects_status_idx
  ON public.installation_projects (status);

DROP TRIGGER IF EXISTS installation_projects_set_updated_at ON public.installation_projects;
CREATE TRIGGER installation_projects_set_updated_at
  BEFORE UPDATE ON public.installation_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

CREATE TABLE IF NOT EXISTS public.installation_visits (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_project_id   uuid NOT NULL REFERENCES public.installation_projects(id) ON DELETE CASCADE,
  visit_number              integer NOT NULL,
  title                     text NOT NULL,
  purpose                   text,
  status                    text NOT NULL DEFAULT 'unscheduled',
  scheduled_start_at        timestamptz,
  scheduled_end_at          timestamptz,
  actual_start_at           timestamptz,
  actual_end_at             timestamptz,
  site_label                text,
  site_recipient_name       text,
  site_address_line_1       text,
  site_address_line_2       text,
  site_city                 text,
  site_county               text,
  site_postcode             text,
  site_country              text NOT NULL DEFAULT 'GB',
  site_phone                text,
  access_instructions       text,
  on_site_contact_name      text,
  on_site_contact_phone     text,
  internal_notes            text,
  completion_notes          text,
  completed_at              timestamptz,
  completed_by_profile_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by                uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT installation_visits_visit_number_positive
    CHECK (visit_number > 0),
  CONSTRAINT installation_visits_title_not_blank
    CHECK (btrim(title) <> ''),
  CONSTRAINT installation_visits_status_check
    CHECK (
      status IN (
        'unscheduled',
        'scheduled',
        'en_route',
        'on_site',
        'completed',
        'cancelled',
        'failed'
      )
    ),
  CONSTRAINT installation_visits_unique_number
    UNIQUE (installation_project_id, visit_number)
);

CREATE INDEX IF NOT EXISTS installation_visits_project_idx
  ON public.installation_visits (installation_project_id, visit_number);

CREATE INDEX IF NOT EXISTS installation_visits_status_idx
  ON public.installation_visits (status);

CREATE INDEX IF NOT EXISTS installation_visits_scheduled_idx
  ON public.installation_visits (scheduled_start_at)
  WHERE status IN ('scheduled', 'en_route', 'on_site');

DROP TRIGGER IF EXISTS installation_visits_set_updated_at ON public.installation_visits;
CREATE TRIGGER installation_visits_set_updated_at
  BEFORE UPDATE ON public.installation_visits
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

CREATE TABLE IF NOT EXISTS public.installation_visit_assignments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_visit_id   uuid NOT NULL REFERENCES public.installation_visits(id) ON DELETE CASCADE,
  profile_id              uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by_profile_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT installation_visit_assignments_unique
    UNIQUE (installation_visit_id, profile_id)
);

CREATE INDEX IF NOT EXISTS installation_visit_assignments_visit_idx
  ON public.installation_visit_assignments (installation_visit_id);

CREATE TABLE IF NOT EXISTS public.installation_visit_documents (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_visit_id   uuid NOT NULL REFERENCES public.installation_visits(id) ON DELETE CASCADE,
  document_kind           text NOT NULL,
  storage_path            text,
  linked_job_file_id      uuid,
  file_name               text NOT NULL,
  mime_type               text NOT NULL,
  byte_size               integer NOT NULL,
  uploaded_by_profile_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT installation_visit_documents_kind_check
    CHECK (
      document_kind IN (
        'rams',
        'artwork',
        'drawing',
        'installation_instructions',
        'other'
      )
    ),
  CONSTRAINT installation_visit_documents_byte_size_positive
    CHECK (byte_size > 0),
  CONSTRAINT installation_visit_documents_storage_or_link
    CHECK (
      storage_path IS NOT NULL
      OR linked_job_file_id IS NOT NULL
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS installation_visit_documents_storage_path_idx
  ON public.installation_visit_documents (storage_path)
  WHERE storage_path IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.installation_visit_photos (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_visit_id   uuid NOT NULL REFERENCES public.installation_visits(id) ON DELETE CASCADE,
  phase                   text NOT NULL,
  storage_path            text NOT NULL UNIQUE,
  file_name               text NOT NULL,
  mime_type               text NOT NULL,
  byte_size               integer NOT NULL,
  captured_at             timestamptz NOT NULL DEFAULT now(),
  uploaded_by_profile_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT installation_visit_photos_phase_check
    CHECK (phase IN ('before', 'during', 'after')),
  CONSTRAINT installation_visit_photos_byte_size_positive
    CHECK (byte_size > 0)
);

CREATE TABLE IF NOT EXISTS public.installation_snag_items (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_visit_id   uuid NOT NULL REFERENCES public.installation_visits(id) ON DELETE CASCADE,
  description             text NOT NULL,
  status                  text NOT NULL DEFAULT 'open',
  severity                text,
  reported_by_profile_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_by_profile_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at             timestamptz,
  resolution_notes        text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT installation_snag_items_description_not_blank
    CHECK (btrim(description) <> ''),
  CONSTRAINT installation_snag_items_status_check
    CHECK (status IN ('open', 'resolved', 'wont_fix'))
);

DROP TRIGGER IF EXISTS installation_snag_items_set_updated_at ON public.installation_snag_items;
CREATE TRIGGER installation_snag_items_set_updated_at
  BEFORE UPDATE ON public.installation_snag_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

CREATE TABLE IF NOT EXISTS public.installation_sign_offs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_visit_id   uuid NOT NULL REFERENCES public.installation_visits(id) ON DELETE CASCADE,
  customer_name           text NOT NULL,
  signed_at               timestamptz NOT NULL DEFAULT now(),
  notes                   text,
  signature_storage_path  text,
  captured_by_profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT installation_sign_offs_customer_name_not_blank
    CHECK (btrim(customer_name) <> ''),
  CONSTRAINT installation_sign_offs_one_per_visit
    UNIQUE (installation_visit_id)
);

CREATE TABLE IF NOT EXISTS public.installation_visit_events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_visit_id   uuid NOT NULL REFERENCES public.installation_visits(id) ON DELETE CASCADE,
  event_type              text NOT NULL,
  actor_profile_id        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  metadata                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT installation_visit_events_type_check
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
        'note_added'
      )
    )
);

CREATE INDEX IF NOT EXISTS installation_visit_events_visit_idx
  ON public.installation_visit_events (installation_visit_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Immutability guards
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.installation_visit_events_prevent_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Installation visit events are append-only.';
END;
$$;

DROP TRIGGER IF EXISTS installation_visit_events_immutable ON public.installation_visit_events;
CREATE TRIGGER installation_visit_events_immutable
  BEFORE UPDATE OR DELETE ON public.installation_visit_events
  FOR EACH ROW
  EXECUTE FUNCTION public.installation_visit_events_prevent_mutation();

CREATE OR REPLACE FUNCTION public.installation_sign_offs_prevent_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Installation sign-off records cannot be deleted.';
  END IF;

  IF TG_OP = 'UPDATE' AND NOT public.is_approved_installation_manager() THEN
    RAISE EXCEPTION 'Installation sign-off records cannot be modified.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS installation_sign_offs_immutable ON public.installation_sign_offs;
CREATE TRIGGER installation_sign_offs_immutable
  BEFORE UPDATE OR DELETE ON public.installation_sign_offs
  FOR EACH ROW
  EXECUTE FUNCTION public.installation_sign_offs_prevent_mutation();

CREATE OR REPLACE FUNCTION public.installation_block_client_table_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.installation_block_direct_client_write() THEN
    RAISE EXCEPTION 'Direct client writes are not permitted. Use installation RPCs.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS installation_projects_block_client ON public.installation_projects;
CREATE TRIGGER installation_projects_block_client
  BEFORE INSERT OR UPDATE OR DELETE ON public.installation_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.installation_block_client_table_writes();

DROP TRIGGER IF EXISTS installation_visits_block_client ON public.installation_visits;
CREATE TRIGGER installation_visits_block_client
  BEFORE INSERT OR UPDATE OR DELETE ON public.installation_visits
  FOR EACH ROW
  EXECUTE FUNCTION public.installation_block_client_table_writes();

DROP TRIGGER IF EXISTS installation_visit_assignments_block_client ON public.installation_visit_assignments;
CREATE TRIGGER installation_visit_assignments_block_client
  BEFORE INSERT OR UPDATE OR DELETE ON public.installation_visit_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.installation_block_client_table_writes();

DROP TRIGGER IF EXISTS installation_visit_documents_block_client ON public.installation_visit_documents;
CREATE TRIGGER installation_visit_documents_block_client
  BEFORE INSERT OR UPDATE OR DELETE ON public.installation_visit_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.installation_block_client_table_writes();

DROP TRIGGER IF EXISTS installation_visit_photos_block_client ON public.installation_visit_photos;
CREATE TRIGGER installation_visit_photos_block_client
  BEFORE INSERT OR UPDATE OR DELETE ON public.installation_visit_photos
  FOR EACH ROW
  EXECUTE FUNCTION public.installation_block_client_table_writes();

DROP TRIGGER IF EXISTS installation_snag_items_block_client ON public.installation_snag_items;
CREATE TRIGGER installation_snag_items_block_client
  BEFORE INSERT OR UPDATE OR DELETE ON public.installation_snag_items
  FOR EACH ROW
  EXECUTE FUNCTION public.installation_block_client_table_writes();

DROP TRIGGER IF EXISTS installation_sign_offs_block_client ON public.installation_sign_offs;
CREATE TRIGGER installation_sign_offs_block_client
  BEFORE INSERT OR UPDATE OR DELETE ON public.installation_sign_offs
  FOR EACH ROW
  EXECUTE FUNCTION public.installation_block_client_table_writes();

DROP TRIGGER IF EXISTS installation_visit_events_block_client ON public.installation_visit_events;
CREATE TRIGGER installation_visit_events_block_client
  BEFORE INSERT OR UPDATE OR DELETE ON public.installation_visit_events
  FOR EACH ROW
  EXECUTE FUNCTION public.installation_block_client_table_writes();

-- ---------------------------------------------------------------------------
-- Event helper (SECURITY DEFINER)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.installation_append_visit_event(
  p_visit_id uuid,
  p_event_type text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_actor uuid := auth.uid();
BEGIN
  INSERT INTO public.installation_visit_events (
    installation_visit_id,
    event_type,
    actor_profile_id,
    metadata
  )
  VALUES (
    p_visit_id,
    p_event_type,
    v_actor,
    coalesce(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.installation_append_visit_event(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.installation_reconcile_for_job(p_job_id uuid)
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
  PERFORM public.installation_assert_manager();

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
      auth.uid()
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
      auth.uid()
    );

    v_created_visit := true;

    PERFORM public.installation_append_visit_event(
      (SELECT id FROM public.installation_visits WHERE installation_project_id = v_project_id AND visit_number = 1),
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

CREATE OR REPLACE FUNCTION public.installation_project_create_manual(
  p_company_id uuid,
  p_title text,
  p_description text DEFAULT NULL,
  p_job_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_job public.jobs%ROWTYPE;
BEGIN
  PERFORM public.installation_assert_manager();

  IF p_job_id IS NOT NULL THEN
    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Job not found.';
    END IF;

    IF v_job.company_id IS DISTINCT FROM p_company_id THEN
      RAISE EXCEPTION 'Job company mismatch.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.installation_projects WHERE job_id = p_job_id) THEN
      RAISE EXCEPTION 'An installation project already exists for this job.';
    END IF;
  END IF;

  INSERT INTO public.installation_projects (
    company_id,
    job_id,
    quote_id,
    quote_version_id,
    title,
    description,
    source,
    status,
    created_by
  )
  VALUES (
    p_company_id,
    p_job_id,
    CASE WHEN p_job_id IS NOT NULL THEN v_job.quote_id ELSE NULL END,
    CASE WHEN p_job_id IS NOT NULL THEN v_job.quote_version_id ELSE NULL END,
    btrim(p_title),
    p_description,
    'manual',
    'active',
    auth.uid()
  )
  RETURNING id INTO v_project_id;

  RETURN v_project_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.installation_visit_create_admin(
  p_project_id uuid,
  p_title text,
  p_purpose text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visit_id uuid;
  v_next_number integer;
BEGIN
  PERFORM public.installation_assert_manager();

  SELECT coalesce(max(visit_number), 0) + 1 INTO v_next_number
  FROM public.installation_visits
  WHERE installation_project_id = p_project_id;

  INSERT INTO public.installation_visits (
    installation_project_id,
    visit_number,
    title,
    purpose,
    status,
    created_by
  )
  VALUES (
    p_project_id,
    v_next_number,
    btrim(p_title),
    p_purpose,
    'unscheduled',
    auth.uid()
  )
  RETURNING id INTO v_visit_id;

  PERFORM public.installation_append_visit_event(
    v_visit_id,
    'status_changed',
    jsonb_build_object('status', 'unscheduled', 'visit_number', v_next_number)
  );

  RETURN v_visit_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.installation_visit_admin_schedule(
  p_visit_id uuid,
  p_status text,
  p_scheduled_start_at timestamptz DEFAULT NULL,
  p_scheduled_end_at timestamptz DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_purpose text DEFAULT NULL,
  p_site_label text DEFAULT NULL,
  p_site_recipient_name text DEFAULT NULL,
  p_site_address_line_1 text DEFAULT NULL,
  p_site_address_line_2 text DEFAULT NULL,
  p_site_city text DEFAULT NULL,
  p_site_county text DEFAULT NULL,
  p_site_postcode text DEFAULT NULL,
  p_site_country text DEFAULT 'GB',
  p_site_phone text DEFAULT NULL,
  p_access_instructions text DEFAULT NULL,
  p_on_site_contact_name text DEFAULT NULL,
  p_on_site_contact_phone text DEFAULT NULL
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

  SELECT status INTO v_prev_status
  FROM public.installation_visits
  WHERE id = p_visit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visit not found.';
  END IF;

  IF p_status NOT IN ('unscheduled', 'scheduled', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid administrative status.';
  END IF;

  UPDATE public.installation_visits
  SET
    status = p_status,
    scheduled_start_at = p_scheduled_start_at,
    scheduled_end_at = p_scheduled_end_at,
    title = coalesce(nullif(btrim(p_title), ''), title),
    purpose = coalesce(p_purpose, purpose),
    site_label = p_site_label,
    site_recipient_name = p_site_recipient_name,
    site_address_line_1 = p_site_address_line_1,
    site_address_line_2 = p_site_address_line_2,
    site_city = p_site_city,
    site_county = p_site_county,
    site_postcode = p_site_postcode,
    site_country = coalesce(nullif(btrim(p_site_country), ''), 'GB'),
    site_phone = p_site_phone,
    access_instructions = p_access_instructions,
    on_site_contact_name = p_on_site_contact_name,
    on_site_contact_phone = p_on_site_contact_phone
  WHERE id = p_visit_id;

  PERFORM public.installation_append_visit_event(
    p_visit_id,
    CASE WHEN p_status = 'scheduled' THEN 'scheduled' ELSE 'status_changed' END,
    jsonb_build_object(
      'previous_status', v_prev_status,
      'new_status', p_status,
      'scheduled_start_at', p_scheduled_start_at,
      'scheduled_end_at', p_scheduled_end_at
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.installation_visit_assign_profile(
  p_visit_id uuid,
  p_profile_id uuid,
  p_remove boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.installation_assert_manager();

  IF p_remove THEN
    DELETE FROM public.installation_visit_assignments
    WHERE installation_visit_id = p_visit_id
      AND profile_id = p_profile_id;

    PERFORM public.installation_append_visit_event(
      p_visit_id,
      'assignment_removed',
      jsonb_build_object('profile_id', p_profile_id)
    );

    RETURN;
  END IF;

  INSERT INTO public.installation_visit_assignments (
    installation_visit_id,
    profile_id,
    assigned_by_profile_id
  )
  VALUES (p_visit_id, p_profile_id, auth.uid())
  ON CONFLICT (installation_visit_id, profile_id) DO NOTHING;

  PERFORM public.installation_append_visit_event(
    p_visit_id,
    'assignment_added',
    jsonb_build_object('profile_id', p_profile_id)
  );
END;
$$;

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
BEGIN
  PERFORM public.installation_assert_operator();

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

CREATE OR REPLACE FUNCTION public.installation_sign_off_capture(
  p_visit_id uuid,
  p_customer_name text,
  p_notes text DEFAULT NULL,
  p_signature_storage_path text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.installation_assert_operator();

  INSERT INTO public.installation_sign_offs (
    installation_visit_id,
    customer_name,
    notes,
    signature_storage_path,
    captured_by_profile_id
  )
  VALUES (
    p_visit_id,
    btrim(p_customer_name),
    p_notes,
    p_signature_storage_path,
    auth.uid()
  )
  ON CONFLICT (installation_visit_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Sign-off already recorded for this visit.';
  END IF;

  PERFORM public.installation_append_visit_event(
    p_visit_id,
    'sign_off_captured',
    jsonb_build_object('sign_off_id', v_id)
  );

  RETURN v_id;
END;
$$;

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
BEGIN
  PERFORM public.installation_assert_operator();

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
BEGIN
  PERFORM public.installation_assert_operator();

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

GRANT EXECUTE ON FUNCTION public.installation_reconcile_for_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installation_project_create_manual(uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installation_visit_create_admin(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installation_visit_admin_schedule(uuid, text, timestamptz, timestamptz, text, text, text, text, text, text, text, text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installation_visit_assign_profile(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installation_visit_operational_progress(uuid, text, timestamptz, timestamptz, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installation_snag_upsert(uuid, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installation_sign_off_capture(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installation_register_visit_document(uuid, text, text, text, text, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.installation_register_visit_photo(uuid, text, text, text, text, integer, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.installation_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installation_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installation_visit_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installation_visit_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installation_visit_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installation_snag_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installation_sign_offs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installation_visit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS installation_projects_select_reader ON public.installation_projects;
CREATE POLICY installation_projects_select_reader
  ON public.installation_projects FOR SELECT TO authenticated
  USING (public.is_approved_installation_reader());

DROP POLICY IF EXISTS installation_visits_select_reader ON public.installation_visits;
CREATE POLICY installation_visits_select_reader
  ON public.installation_visits FOR SELECT TO authenticated
  USING (public.is_approved_installation_reader());

DROP POLICY IF EXISTS installation_visit_assignments_select_reader ON public.installation_visit_assignments;
CREATE POLICY installation_visit_assignments_select_reader
  ON public.installation_visit_assignments FOR SELECT TO authenticated
  USING (public.is_approved_installation_reader());

DROP POLICY IF EXISTS installation_visit_documents_select_reader ON public.installation_visit_documents;
CREATE POLICY installation_visit_documents_select_reader
  ON public.installation_visit_documents FOR SELECT TO authenticated
  USING (public.is_approved_installation_reader());

DROP POLICY IF EXISTS installation_visit_photos_select_reader ON public.installation_visit_photos;
CREATE POLICY installation_visit_photos_select_reader
  ON public.installation_visit_photos FOR SELECT TO authenticated
  USING (public.is_approved_installation_reader());

DROP POLICY IF EXISTS installation_snag_items_select_reader ON public.installation_snag_items;
CREATE POLICY installation_snag_items_select_reader
  ON public.installation_snag_items FOR SELECT TO authenticated
  USING (public.is_approved_installation_reader());

DROP POLICY IF EXISTS installation_sign_offs_select_reader ON public.installation_sign_offs;
CREATE POLICY installation_sign_offs_select_reader
  ON public.installation_sign_offs FOR SELECT TO authenticated
  USING (public.is_approved_installation_reader());

DROP POLICY IF EXISTS installation_visit_events_select_reader ON public.installation_visit_events;
CREATE POLICY installation_visit_events_select_reader
  ON public.installation_visit_events FOR SELECT TO authenticated
  USING (public.is_approved_installation_reader());

-- ---------------------------------------------------------------------------
-- Storage bucket + policies
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'installation-files',
  'installation-files',
  false,
  26214400,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.storage_installation_visit_id_from_path(p_path text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN split_part(p_path, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN split_part(p_path, '/', 1)::uuid
    ELSE NULL::uuid
  END;
$$;

DROP POLICY IF EXISTS installation_files_select_reader ON storage.objects;
CREATE POLICY installation_files_select_reader
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'installation-files'
    AND public.is_approved_installation_reader()
    AND public.storage_installation_visit_id_from_path(name) IS NOT NULL
  );

DROP POLICY IF EXISTS installation_files_insert_operator ON storage.objects;
CREATE POLICY installation_files_insert_operator
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'installation-files'
    AND public.is_approved_installation_operator()
    AND public.storage_installation_visit_id_from_path(name) IS NOT NULL
  );

DROP POLICY IF EXISTS installation_files_delete_manager ON storage.objects;
CREATE POLICY installation_files_delete_manager
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'installation-files'
    AND public.is_approved_installation_manager()
  );

REVOKE ALL ON FUNCTION public.storage_installation_visit_id_from_path(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.installation_version_requires_project(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
