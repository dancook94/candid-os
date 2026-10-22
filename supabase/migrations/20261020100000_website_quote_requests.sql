-- Website quote requests can exist before a company, contact, or portal account.
-- Customer portal requests stay fully linked. Apply manually. Do not run from the app.
--
-- This migration does not change quotes, quote_versions, quote_items, or their
-- customer visibility policies. Historical issued quotations stay company-scoped.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Quote request source and website submitter snapshot
-- ---------------------------------------------------------------------------

ALTER TABLE public.quote_requests
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'customer_portal',
  ADD COLUMN IF NOT EXISTS submitter_name text,
  ADD COLUMN IF NOT EXISTS submitter_company_name text,
  ADD COLUMN IF NOT EXISTS submitter_email text,
  ADD COLUMN IF NOT EXISTS submitter_phone text,
  ADD COLUMN IF NOT EXISTS project_location text,
  ADD COLUMN IF NOT EXISTS existing_job_reference text,
  ADD COLUMN IF NOT EXISTS artwork_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS external_submission_id text,
  ADD COLUMN IF NOT EXISTS suggested_contact_id uuid,
  ADD COLUMN IF NOT EXISTS suggested_company_id uuid;

ALTER TABLE public.quote_requests
  ALTER COLUMN company_id DROP NOT NULL,
  ALTER COLUMN requested_by DROP NOT NULL,
  ALTER COLUMN fulfilment_method DROP NOT NULL,
  ALTER COLUMN requested_date DROP NOT NULL;

ALTER TABLE public.quote_requests
  DROP CONSTRAINT IF EXISTS quote_requests_source_check;

ALTER TABLE public.quote_requests
  ADD CONSTRAINT quote_requests_source_check
  CHECK (source IN ('customer_portal', 'website'));

ALTER TABLE public.quote_requests
  DROP CONSTRAINT IF EXISTS quote_requests_portal_shape_check;

ALTER TABLE public.quote_requests
  ADD CONSTRAINT quote_requests_portal_shape_check
  CHECK (
    source <> 'customer_portal'
    OR (
      company_id IS NOT NULL
      AND requested_by IS NOT NULL
      AND fulfilment_method IS NOT NULL
      AND requested_date IS NOT NULL
      AND external_submission_id IS NULL
      AND suggested_contact_id IS NULL
      AND suggested_company_id IS NULL
    )
  );

ALTER TABLE public.quote_requests
  DROP CONSTRAINT IF EXISTS quote_requests_website_shape_check;

ALTER TABLE public.quote_requests
  ADD CONSTRAINT quote_requests_website_shape_check
  CHECK (
    source <> 'website'
    OR (
      requested_by IS NULL
      AND external_submission_id IS NOT NULL
      AND btrim(external_submission_id) <> ''
      AND submitter_name IS NOT NULL
      AND btrim(submitter_name) <> ''
      AND submitter_email IS NOT NULL
      AND btrim(submitter_email) <> ''
      AND submitter_email ~* '^[^@]+@[^@]+\.[^@]+$'
    )
  );

-- company_id stays null until staff explicitly link an existing company.
-- suggested_company_id is never copied into company_id by this migration.
-- Customer portal policies still hide source = website, including after a link.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quote_requests_suggested_contact_id_fkey'
      AND conrelid = 'public.quote_requests'::regclass
  ) THEN
    ALTER TABLE public.quote_requests
      ADD CONSTRAINT quote_requests_suggested_contact_id_fkey
      FOREIGN KEY (suggested_contact_id)
      REFERENCES public.contacts (id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quote_requests_suggested_company_id_fkey'
      AND conrelid = 'public.quote_requests'::regclass
  ) THEN
    ALTER TABLE public.quote_requests
      ADD CONSTRAINT quote_requests_suggested_company_id_fkey
      FOREIGN KEY (suggested_company_id)
      REFERENCES public.companies (id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS quote_requests_external_submission_id_uidx
  ON public.quote_requests (external_submission_id)
  WHERE external_submission_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS quote_requests_source_idx
  ON public.quote_requests (source);

CREATE INDEX IF NOT EXISTS quote_requests_suggested_contact_id_idx
  ON public.quote_requests (suggested_contact_id)
  WHERE suggested_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS quote_requests_suggested_company_id_idx
  ON public.quote_requests (suggested_company_id)
  WHERE suggested_company_id IS NOT NULL;

COMMENT ON COLUMN public.quote_requests.source IS
  'customer_portal requests stay linked to a company and approved profile. website requests are unlinked public enquiries.';
COMMENT ON COLUMN public.quote_requests.suggested_contact_id IS
  'Optional staff hint from an email match. It does not link the enquiry.';
COMMENT ON COLUMN public.quote_requests.suggested_company_id IS
  'Optional staff hint. It does not set company_id.';
COMMENT ON COLUMN public.quote_requests.external_submission_id IS
  'Idempotency key for a website submission. Required for website rows and empty for portal rows.';

-- ---------------------------------------------------------------------------
-- 2. Suggestion integrity. Does not copy a suggestion onto company_id.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.quote_requests_prepare_website_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  contact_company_id uuid;
BEGIN
  IF NEW.submitter_name IS NOT NULL THEN
    NEW.submitter_name := NULLIF(btrim(NEW.submitter_name), '');
  END IF;

  IF NEW.submitter_company_name IS NOT NULL THEN
    NEW.submitter_company_name := NULLIF(btrim(NEW.submitter_company_name), '');
  END IF;

  IF NEW.submitter_email IS NOT NULL THEN
    NEW.submitter_email := NULLIF(lower(btrim(NEW.submitter_email)), '');
  END IF;

  IF NEW.submitter_phone IS NOT NULL THEN
    NEW.submitter_phone := NULLIF(btrim(NEW.submitter_phone), '');
  END IF;

  IF NEW.project_location IS NOT NULL THEN
    NEW.project_location := NULLIF(btrim(NEW.project_location), '');
  END IF;

  IF NEW.existing_job_reference IS NOT NULL THEN
    NEW.existing_job_reference := NULLIF(btrim(NEW.existing_job_reference), '');
  END IF;

  IF NEW.external_submission_id IS NOT NULL THEN
    NEW.external_submission_id := NULLIF(btrim(NEW.external_submission_id), '');
  END IF;

  IF NEW.suggested_contact_id IS NOT NULL THEN
    SELECT contacts.company_id
    INTO contact_company_id
    FROM public.contacts
    WHERE contacts.id = NEW.suggested_contact_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Suggested contact does not exist'
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NEW.suggested_company_id IS NOT NULL
      AND contact_company_id IS DISTINCT FROM NEW.suggested_company_id THEN
      RAISE EXCEPTION 'Suggested contact does not belong to the suggested company'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.quote_requests_prepare_website_fields() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quote_requests_prepare_website_fields() TO authenticated, service_role;

DROP TRIGGER IF EXISTS quote_requests_prepare_website_fields ON public.quote_requests;
CREATE TRIGGER quote_requests_prepare_website_fields
  BEFORE INSERT OR UPDATE ON public.quote_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.quote_requests_prepare_website_fields();

-- ---------------------------------------------------------------------------
-- 3. RLS. No anonymous insert. Portal customers cannot create or read website rows.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Approved customers can create quote requests" ON public.quote_requests;
CREATE POLICY "Approved customers can create quote requests"
  ON public.quote_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    source = 'customer_portal'
    AND requested_by = auth.uid()
    AND company_id = (
      SELECT profiles.company_id
      FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.account_status = 'approved'
    )
  );

DROP POLICY IF EXISTS "Customers can view their company quote requests" ON public.quote_requests;
CREATE POLICY "Customers can view their company quote requests"
  ON public.quote_requests
  FOR SELECT
  TO authenticated
  USING (
    source = 'customer_portal'
    AND company_id = (
      SELECT profiles.company_id
      FROM public.profiles
      WHERE profiles.id = auth.uid()
    )
  );

-- Admin select and update policies are left unchanged.

-- ---------------------------------------------------------------------------
-- 4. Dropbox artwork metadata for website requests only.
-- Portal files remain in quote_request_attachments / quote-request-files.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.quote_request_dropbox_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id uuid NOT NULL
    REFERENCES public.quote_requests (id) ON DELETE CASCADE,
  original_file_name text NOT NULL,
  dropbox_file_id text,
  dropbox_path text,
  file_size_bytes bigint,
  mime_type text,
  upload_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quote_request_dropbox_files_name_not_blank
    CHECK (btrim(original_file_name) <> ''),
  CONSTRAINT quote_request_dropbox_files_size_non_negative
    CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  CONSTRAINT quote_request_dropbox_files_status_check
    CHECK (upload_status IN ('pending', 'uploaded', 'failed')),
  CONSTRAINT quote_request_dropbox_files_uploaded_location_check
    CHECK (
      upload_status <> 'uploaded'
      OR dropbox_file_id IS NOT NULL
      OR dropbox_path IS NOT NULL
    ),
  CONSTRAINT quote_request_dropbox_files_no_public_url
    CHECK (
      (dropbox_file_id IS NULL OR dropbox_file_id !~* '^https?://')
      AND (dropbox_path IS NULL OR dropbox_path !~* '^https?://')
    )
);

COMMENT ON TABLE public.quote_request_dropbox_files IS
  'Dropbox artwork metadata for website quote requests. No sharing links or access tokens.';

CREATE INDEX IF NOT EXISTS quote_request_dropbox_files_request_idx
  ON public.quote_request_dropbox_files (quote_request_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.quote_request_dropbox_files_require_website()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_source text;
BEGIN
  SELECT quote_requests.source
  INTO request_source
  FROM public.quote_requests
  WHERE quote_requests.id = NEW.quote_request_id;

  IF request_source IS DISTINCT FROM 'website' THEN
    RAISE EXCEPTION 'Dropbox artwork files can only be attached to website quote requests'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.original_file_name := btrim(NEW.original_file_name);
  IF NEW.dropbox_file_id IS NOT NULL THEN
    NEW.dropbox_file_id := NULLIF(btrim(NEW.dropbox_file_id), '');
  END IF;
  IF NEW.dropbox_path IS NOT NULL THEN
    NEW.dropbox_path := NULLIF(btrim(NEW.dropbox_path), '');
  END IF;
  IF NEW.mime_type IS NOT NULL THEN
    NEW.mime_type := NULLIF(btrim(NEW.mime_type), '');
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.quote_request_dropbox_files_require_website() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quote_request_dropbox_files_require_website() TO authenticated, service_role;

DROP TRIGGER IF EXISTS quote_request_dropbox_files_require_website
  ON public.quote_request_dropbox_files;
CREATE TRIGGER quote_request_dropbox_files_require_website
  BEFORE INSERT OR UPDATE ON public.quote_request_dropbox_files
  FOR EACH ROW
  EXECUTE FUNCTION public.quote_request_dropbox_files_require_website();

ALTER TABLE public.quote_request_dropbox_files ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.quote_request_dropbox_files FROM PUBLIC;
REVOKE ALL ON TABLE public.quote_request_dropbox_files FROM anon;
REVOKE ALL ON TABLE public.quote_request_dropbox_files FROM authenticated;
GRANT SELECT ON TABLE public.quote_request_dropbox_files TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.quote_request_dropbox_files TO service_role;

DROP POLICY IF EXISTS quote_request_dropbox_files_select_admin
  ON public.quote_request_dropbox_files;
CREATE POLICY quote_request_dropbox_files_select_admin
  ON public.quote_request_dropbox_files
  FOR SELECT
  TO authenticated
  USING (public.is_candid_admin());

-- No insert, update, or delete policy for authenticated or anon.
-- The future server-to-server route uses the service role, which bypasses RLS.
-- Table checks still apply to the service role.

COMMIT;
