-- Proposed migration: optional customer company logos (portal branding only)
-- Review and apply manually in Supabase. Do not run automatically from the app.
--
-- Branding rule: Candid logo (/public/LOGO_YELLOW.svg) remains on quotations,
-- PDFs, emails, login, and portal navigation. Company logos are an additional
-- account identity element in the customer portal only.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. companies table: logo metadata columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS logo_storage_path text,
  ADD COLUMN IF NOT EXISTS logo_file_name text,
  ADD COLUMN IF NOT EXISTS logo_file_type text,
  ADD COLUMN IF NOT EXISTS logo_file_size bigint;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_logo_file_size_check
  CHECK (logo_file_size IS NULL OR (logo_file_size >= 0 AND logo_file_size <= 5242880));

COMMENT ON COLUMN public.companies.logo_storage_path IS
  'Private storage path in company-logos bucket: {company_id}/{timestamp}-{file}';
COMMENT ON COLUMN public.companies.logo_file_name IS 'Original uploaded file name';
COMMENT ON COLUMN public.companies.logo_file_type IS 'MIME type of uploaded logo';
COMMENT ON COLUMN public.companies.logo_file_size IS 'Uploaded logo size in bytes (max 5 MB)';

-- ---------------------------------------------------------------------------
-- 2. Helper: extract company_id from storage object path
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.storage_company_id_from_path(path text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(split_part(path, '/', 1), '')::uuid;
$$;

-- ---------------------------------------------------------------------------
-- 3. companies RLS: admin logo management + customer read own company
--    (Skip policies that already exist in your project; adjust names if needed.)
-- ---------------------------------------------------------------------------

-- Admins (admin + super_admin) may update logo metadata on any company
CREATE POLICY "Approved admins can update company logos"
  ON public.companies
  FOR UPDATE
  TO authenticated
  USING (public.is_candid_admin())
  WITH CHECK (public.is_candid_admin());

-- Approved customers may read their linked company (including logo metadata)
CREATE POLICY "Approved customers can read own company"
  ON public.companies
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.account_status = 'approved'
        AND p.company_id = companies.id
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Storage bucket: company-logos (private)
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-logos',
  'company-logos',
  false,
  5242880,
  ARRAY[
    'image/svg+xml',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 5. storage.objects RLS for company-logos
-- ---------------------------------------------------------------------------

-- Admins: read any company logo (signed URL generation)
CREATE POLICY "Approved admins can read company logos"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'company-logos'
    AND public.is_candid_admin()
  );

-- Approved customers: read only their own company folder
CREATE POLICY "Approved customers can read own company logo"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'company-logos'
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.account_status = 'approved'
        AND p.company_id = public.storage_company_id_from_path(name)
    )
  );

-- Admins: upload logos to any company folder
CREATE POLICY "Approved admins can upload company logos"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'company-logos'
    AND public.is_candid_admin()
    AND public.storage_company_id_from_path(name) IS NOT NULL
  );

-- Admins: replace/remove logos
CREATE POLICY "Approved admins can delete company logos"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'company-logos'
    AND public.is_candid_admin()
  );

COMMIT;

-- Notes:
-- 1. If companies already has SELECT/UPDATE policies, merge rather than duplicate.
-- 2. is_candid_admin() must return true for approved admin and super_admin roles.
-- 3. Customers cannot upload or delete logos; admin company page handles management.
-- 4. Storage path format enforced by app: {company_id}/{timestamp}-{sanitised-file-name}
-- 5. Apply this migration before using the portal branding UI in production.
