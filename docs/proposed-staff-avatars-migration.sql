-- Proposed migration: staff profile avatars (Candid staff roles only)
-- Review and apply manually in Supabase. Do not run automatically from the app.
--
-- Staff roles: super_admin, admin, sales, production, accounts
-- Customers must not upload or access staff avatar files.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. profiles table: avatar metadata columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_storage_path text,
  ADD COLUMN IF NOT EXISTS avatar_file_name text,
  ADD COLUMN IF NOT EXISTS avatar_file_type text,
  ADD COLUMN IF NOT EXISTS avatar_file_size bigint;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_avatar_file_size_check
  CHECK (avatar_file_size IS NULL OR (avatar_file_size >= 0 AND avatar_file_size <= 5242880));

COMMENT ON COLUMN public.profiles.avatar_storage_path IS
  'Private storage path in staff-avatars bucket: {profile_id}/{timestamp}-{file}';
COMMENT ON COLUMN public.profiles.avatar_file_name IS 'Original uploaded avatar file name';
COMMENT ON COLUMN public.profiles.avatar_file_type IS 'MIME type of uploaded avatar';
COMMENT ON COLUMN public.profiles.avatar_file_size IS 'Uploaded avatar size in bytes (max 5 MB)';

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.storage_profile_id_from_path(path text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(split_part(path, '/', 1), '')::uuid;
$$;

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

-- ---------------------------------------------------------------------------
-- 3. profiles RLS: staff self-service + super_admin management
--    (Skip policies that already exist; merge with your project policies.)
-- ---------------------------------------------------------------------------

-- Approved staff may update their own avatar metadata
CREATE POLICY "Approved staff can update own avatar metadata"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    id = auth.uid()
    AND public.is_approved_staff()
  )
  WITH CHECK (
    id = auth.uid()
    AND public.is_approved_staff()
  );

-- Super admins may update avatar metadata on other staff profiles
CREATE POLICY "Super admins can update staff avatar metadata"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles requester
      WHERE requester.id = auth.uid()
        AND requester.user_role = 'super_admin'
        AND requester.account_status = 'approved'
    )
    AND user_role IN ('admin', 'sales', 'production', 'accounts')
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles requester
      WHERE requester.id = auth.uid()
        AND requester.user_role = 'super_admin'
        AND requester.account_status = 'approved'
    )
    AND user_role IN ('admin', 'sales', 'production', 'accounts')
  );

-- Approved admins may read staff avatar metadata (for signed URL generation)
CREATE POLICY "Approved admins can read staff avatar metadata"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    public.is_candid_admin()
    AND user_role IN (
      'super_admin',
      'admin',
      'sales',
      'production',
      'accounts'
    )
  );

-- Approved staff may read their own avatar metadata
CREATE POLICY "Approved staff can read own avatar metadata"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    AND public.is_approved_staff()
  );

-- ---------------------------------------------------------------------------
-- 4. Storage bucket: staff-avatars (private, no SVG)
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'staff-avatars',
  'staff-avatars',
  false,
  5242880,
  ARRAY[
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
-- 5. storage.objects RLS for staff-avatars
-- ---------------------------------------------------------------------------

-- Staff: read own avatar folder
CREATE POLICY "Approved staff can read own avatar"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'staff-avatars'
    AND public.storage_profile_id_from_path(name) = auth.uid()
    AND public.is_approved_staff()
  );

-- Admins: read any staff avatar (admin + super_admin via is_candid_admin)
CREATE POLICY "Approved admins can read staff avatars"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'staff-avatars'
    AND public.is_candid_admin()
  );

-- Staff: upload to own folder only
CREATE POLICY "Approved staff can upload own avatar"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'staff-avatars'
    AND public.storage_profile_id_from_path(name) = auth.uid()
    AND public.is_approved_staff()
  );

-- Super admins: upload to any staff folder
CREATE POLICY "Super admins can upload staff avatars"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'staff-avatars'
    AND EXISTS (
      SELECT 1
      FROM public.profiles requester
      WHERE requester.id = auth.uid()
        AND requester.user_role = 'super_admin'
        AND requester.account_status = 'approved'
    )
    AND public.storage_profile_id_from_path(name) IS NOT NULL
  );

-- Staff: delete own avatar files
CREATE POLICY "Approved staff can delete own avatar"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'staff-avatars'
    AND public.storage_profile_id_from_path(name) = auth.uid()
    AND public.is_approved_staff()
  );

-- Super admins: delete any staff avatar file
CREATE POLICY "Super admins can delete staff avatars"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'staff-avatars'
    AND EXISTS (
      SELECT 1
      FROM public.profiles requester
      WHERE requester.id = auth.uid()
        AND requester.user_role = 'super_admin'
        AND requester.account_status = 'approved'
    )
  );

COMMIT;

-- Notes:
-- 1. App upload/remove routes verify auth server-side and may use the service role
--    after validation. Storage policies still protect direct client access.
-- 2. Customers have no SELECT/INSERT/DELETE policies on staff-avatars.
-- 3. SVG uploads are rejected in application validation; bucket MIME list excludes SVG.
-- 4. Merge with existing profiles/storage policies if they conflict.
