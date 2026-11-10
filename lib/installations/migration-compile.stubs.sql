-- Stubs so installation_management_phase1.sql compiles on disposable Postgres.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULL::uuid;
$$;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text,
  name text
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  account_status text NOT NULL DEFAULT 'approved',
  user_role text NOT NULL DEFAULT 'admin'
);

CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE TABLE IF NOT EXISTS public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE TABLE IF NOT EXISTS public.quote_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  quote_id uuid REFERENCES public.quotes(id),
  quote_version_id uuid REFERENCES public.quote_versions(id),
  job_reference text NOT NULL DEFAULT 'J-1',
  project_name text
);

CREATE TABLE IF NOT EXISTS public.quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_version_id uuid NOT NULL REFERENCES public.quote_versions(id),
  title text NOT NULL,
  is_optional boolean NOT NULL DEFAULT false,
  is_selected boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.quote_item_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_item_id uuid NOT NULL REFERENCES public.quote_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.quote_item_cost_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_item_cost_id uuid NOT NULL REFERENCES public.quote_item_costs(id) ON DELETE CASCADE,
  component_type text NOT NULL
);

CREATE OR REPLACE FUNCTION public.is_approved_candid_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT true;
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
