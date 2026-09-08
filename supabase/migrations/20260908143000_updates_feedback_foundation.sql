-- Updates & Feedback foundation (changelog, read state, problem reports, attachments).
-- Apply manually in Supabase. DO NOT run automatically from the app.

BEGIN;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_approved_staff()
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
      AND p.user_role IN (
        'super_admin',
        'admin',
        'sales',
        'production',
        'accounts'
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_approved_candid_admin()
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
      AND p.user_role IN ('super_admin', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_approved_customer()
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
      AND p.user_role = 'customer'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_product_update_audience(target_audience text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    target_audience = 'everyone'
    OR (
      target_audience = 'staff'
      AND public.is_approved_staff()
    )
    OR (
      target_audience = 'customers'
      AND public.is_approved_customer()
    );
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.storage_problem_report_id_from_path(path text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public
AS $$
DECLARE
  segment text;
BEGIN
  IF path IS NULL OR btrim(path) = '' THEN
    RETURN NULL;
  END IF;

  segment := split_part(path, '/', 1);

  IF segment IS NULL OR btrim(segment) = '' THEN
    RETURN NULL;
  END IF;

  IF segment ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN segment::uuid;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.storage_problem_report_id_from_path(text) IS
  'Extract report UUID from storage object path; returns NULL for empty or malformed paths.';

-- ---------------------------------------------------------------------------
-- Product updates (changelog)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.product_updates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  body          text NOT NULL,
  category      text NOT NULL,
  audience        text NOT NULL,
  is_published  boolean NOT NULL DEFAULT false,
  published_at  timestamptz,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT product_updates_category_check
    CHECK (category IN ('new', 'improvement', 'fix')),
  CONSTRAINT product_updates_audience_check
    CHECK (audience IN ('everyone', 'staff', 'customers')),
  CONSTRAINT product_updates_published_at_check
    CHECK (
      (is_published = false AND published_at IS NULL)
      OR (is_published = true AND published_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS product_updates_published_at_idx
  ON public.product_updates (published_at DESC)
  WHERE is_published = true;

CREATE INDEX IF NOT EXISTS product_updates_created_at_idx
  ON public.product_updates (created_at DESC);

DROP TRIGGER IF EXISTS product_updates_set_updated_at ON public.product_updates;
CREATE TRIGGER product_updates_set_updated_at
  BEFORE UPDATE ON public.product_updates
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

-- ---------------------------------------------------------------------------
-- Per-user read state
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.product_update_reads (
  update_id uuid NOT NULL REFERENCES public.product_updates(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (update_id, user_id)
);

CREATE INDEX IF NOT EXISTS product_update_reads_user_id_idx
  ON public.product_update_reads (user_id);

-- ---------------------------------------------------------------------------
-- Problem reports
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.problem_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id       uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  reporter_name    text NOT NULL,
  reporter_email   text NOT NULL,
  reporter_role    text NOT NULL,
  description      text NOT NULL,
  attempted_action text,
  priority         text NOT NULL DEFAULT 'minor',
  status           text NOT NULL DEFAULT 'reported',
  source_path      text,
  user_agent       text,
  admin_notes      text,
  resolved_at      timestamptz,
  resolved_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT problem_reports_priority_check
    CHECK (priority IN ('minor', 'blocking')),
  CONSTRAINT problem_reports_status_check
    CHECK (status IN (
      'reported',
      'reviewing',
      'planned',
      'in_progress',
      'fixed',
      'closed'
    ))
);

CREATE INDEX IF NOT EXISTS problem_reports_created_at_idx
  ON public.problem_reports (created_at DESC);

CREATE INDEX IF NOT EXISTS problem_reports_reporter_id_idx
  ON public.problem_reports (reporter_id);

CREATE INDEX IF NOT EXISTS problem_reports_status_idx
  ON public.problem_reports (status);

CREATE INDEX IF NOT EXISTS problem_reports_priority_idx
  ON public.problem_reports (priority);

DROP TRIGGER IF EXISTS problem_reports_set_updated_at ON public.problem_reports;
CREATE TRIGGER problem_reports_set_updated_at
  BEFORE UPDATE ON public.problem_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

-- ---------------------------------------------------------------------------
-- Problem report attachments (optional screenshot/file)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.problem_report_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     uuid NOT NULL REFERENCES public.problem_reports(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,
  file_name     text NOT NULL,
  file_type     text NOT NULL,
  file_size     bigint NOT NULL,
  uploaded_by   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT problem_report_attachments_file_size_check
    CHECK (file_size >= 0 AND file_size <= 10485760)
);

CREATE UNIQUE INDEX IF NOT EXISTS problem_report_attachments_report_id_idx
  ON public.problem_report_attachments (report_id);

-- ---------------------------------------------------------------------------
-- Storage bucket
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'problem-report-files',
  'problem-report-files',
  false,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- RLS: product_updates
-- ---------------------------------------------------------------------------

ALTER TABLE public.product_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_updates_select_visible ON public.product_updates;
CREATE POLICY product_updates_select_visible
  ON public.product_updates FOR SELECT TO authenticated
  USING (
    public.is_approved_candid_admin()
    OR (
      is_published = true
      AND published_at IS NOT NULL
      AND published_at <= now()
      AND public.can_view_product_update_audience(audience)
    )
  );

DROP POLICY IF EXISTS product_updates_insert_admin ON public.product_updates;
CREATE POLICY product_updates_insert_admin
  ON public.product_updates FOR INSERT TO authenticated
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS product_updates_update_admin ON public.product_updates;
CREATE POLICY product_updates_update_admin
  ON public.product_updates FOR UPDATE TO authenticated
  USING (public.is_approved_candid_admin())
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS product_updates_delete_admin ON public.product_updates;
CREATE POLICY product_updates_delete_admin
  ON public.product_updates FOR DELETE TO authenticated
  USING (public.is_approved_candid_admin());

-- ---------------------------------------------------------------------------
-- RLS: product_update_reads
-- ---------------------------------------------------------------------------

ALTER TABLE public.product_update_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_update_reads_select_own ON public.product_update_reads;
CREATE POLICY product_update_reads_select_own
  ON public.product_update_reads FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS product_update_reads_insert_own ON public.product_update_reads;
CREATE POLICY product_update_reads_insert_own
  ON public.product_update_reads FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS product_update_reads_update_own ON public.product_update_reads;
CREATE POLICY product_update_reads_update_own
  ON public.product_update_reads FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RLS: problem_reports
-- ---------------------------------------------------------------------------

ALTER TABLE public.problem_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS problem_reports_select_own ON public.problem_reports;
CREATE POLICY problem_reports_select_own
  ON public.problem_reports FOR SELECT TO authenticated
  USING (reporter_id = auth.uid());

DROP POLICY IF EXISTS problem_reports_select_admin ON public.problem_reports;
CREATE POLICY problem_reports_select_admin
  ON public.problem_reports FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

-- Report creation is server-mediated via the service role after API auth checks.
-- Authenticated clients must not INSERT directly; this prevents spoofing snapshot
-- identity columns (reporter_role, company_id, reporter_name, reporter_email).

DROP POLICY IF EXISTS problem_reports_insert_own ON public.problem_reports;

DROP POLICY IF EXISTS problem_reports_update_admin ON public.problem_reports;
CREATE POLICY problem_reports_update_admin
  ON public.problem_reports FOR UPDATE TO authenticated
  USING (public.is_approved_candid_admin())
  WITH CHECK (public.is_approved_candid_admin());

-- ---------------------------------------------------------------------------
-- RLS: problem_report_attachments
-- ---------------------------------------------------------------------------

ALTER TABLE public.problem_report_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS problem_report_attachments_select_own ON public.problem_report_attachments;
CREATE POLICY problem_report_attachments_select_own
  ON public.problem_report_attachments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.problem_reports pr
      WHERE pr.id = report_id
        AND pr.reporter_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS problem_report_attachments_select_admin ON public.problem_report_attachments;
CREATE POLICY problem_report_attachments_select_admin
  ON public.problem_report_attachments FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

-- Attachment metadata is written server-side via the service role after auth checks.

DROP POLICY IF EXISTS problem_report_attachments_insert_own ON public.problem_report_attachments;

-- ---------------------------------------------------------------------------
-- RLS: storage.objects for problem-report-files
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS problem_report_files_select_own ON storage.objects;
CREATE POLICY problem_report_files_select_own
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'problem-report-files'
    AND (
      public.is_approved_candid_admin()
      OR EXISTS (
        SELECT 1
        FROM public.problem_reports pr
        WHERE pr.id = public.storage_problem_report_id_from_path(name)
          AND pr.reporter_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS problem_report_files_insert_own ON storage.objects;
CREATE POLICY problem_report_files_insert_own
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'problem-report-files'
    AND EXISTS (
      SELECT 1
      FROM public.problem_reports pr
      WHERE pr.id = public.storage_problem_report_id_from_path(name)
        AND pr.reporter_id = auth.uid()
    )
  );

-- SECURITY DEFINER helpers are invoked from RLS policies only.
REVOKE ALL ON FUNCTION public.is_approved_staff() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_approved_candid_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_approved_customer() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_product_update_audience(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.storage_problem_report_id_from_path(text) FROM PUBLIC;

COMMIT;
