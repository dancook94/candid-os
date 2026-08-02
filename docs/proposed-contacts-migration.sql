-- Proposed migration: CRM Contacts (people separate from portal profiles)
-- Review and apply manually in Supabase. Do not run automatically from the app.
--
-- Goal: Staff can create companies, contacts, opportunities and quotes before any
-- customer registers for portal access. Portal invitation links an existing contact
-- to a profile — it does not create a duplicate person record.
--
-- Prerequisites:
--   public.companies
--   public.profiles
--   public.opportunities (CRM foundation migration)
--   public.quotes
--   public.is_approved_crm_staff()
--   public.is_approved_crm_admin()
--   public.set_updated_at()
--
-- Does NOT modify RLS on companies, profiles, quotes, or quote_requests.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. contacts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  full_name     text NOT NULL,
  email         text,
  phone         text,
  job_title     text,
  notes         text,
  is_primary    boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  profile_id    uuid UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
  invited_at    timestamptz,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contacts_full_name_not_blank CHECK (btrim(full_name) <> ''),
  CONSTRAINT contacts_email_not_blank CHECK (email IS NULL OR btrim(email) <> ''),
  CONSTRAINT contacts_email_basic_format CHECK (
    email IS NULL OR email ~* '^[^@]+@[^@]+\.[^@]+$'
  ),
  CONSTRAINT contacts_invited_requires_email CHECK (
    invited_at IS NULL OR email IS NOT NULL
  )
);

COMMENT ON TABLE public.contacts IS
  'CRM people at customer companies. May exist without portal access (profile_id NULL).';
COMMENT ON COLUMN public.contacts.profile_id IS
  'Linked portal profile when the contact has authenticated access. Unique when present.';
COMMENT ON COLUMN public.contacts.invited_at IS
  'When a portal invitation was last sent. NULL = never invited.';

-- Case-insensitive email unique per company (active contacts only).
-- Inactive contacts release the email for reuse within the same company.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_company_email_unique_idx
  ON public.contacts (company_id, lower(btrim(email)))
  WHERE email IS NOT NULL AND is_active = true;

-- One primary active contact per company.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_one_primary_per_company_idx
  ON public.contacts (company_id)
  WHERE is_primary = true AND is_active = true;

CREATE INDEX IF NOT EXISTS contacts_company_id_idx
  ON public.contacts (company_id);
CREATE INDEX IF NOT EXISTS contacts_company_active_name_idx
  ON public.contacts (company_id, is_active, full_name);
CREATE INDEX IF NOT EXISTS contacts_profile_id_idx
  ON public.contacts (profile_id)
  WHERE profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_email_lower_idx
  ON public.contacts (lower(btrim(email)))
  WHERE email IS NOT NULL;

DROP TRIGGER IF EXISTS contacts_set_updated_at ON public.contacts;
CREATE TRIGGER contacts_set_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Normalisation + validation triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.normalize_contact_email(raw_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN raw_email IS NULL OR btrim(raw_email) = '' THEN NULL
    ELSE lower(btrim(raw_email))
  END;
$$;

CREATE OR REPLACE FUNCTION public.contacts_normalize_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.email := public.normalize_contact_email(NEW.email);
  NEW.full_name := btrim(NEW.full_name);
  NEW.phone := NULLIF(btrim(COALESCE(NEW.phone, '')), '');
  NEW.job_title := NULLIF(btrim(COALESCE(NEW.job_title, '')), '');
  NEW.notes := NULLIF(btrim(COALESCE(NEW.notes, '')), '');

  IF NEW.is_active = false THEN
    NEW.is_primary := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_normalize_fields ON public.contacts;
CREATE TRIGGER contacts_normalize_fields
  BEFORE INSERT OR UPDATE ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.contacts_normalize_fields();

CREATE OR REPLACE FUNCTION public.validate_contact_profile_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  linked_role text;
  linked_company_id uuid;
  linked_status text;
BEGIN
  IF NEW.profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.user_role, p.company_id, p.account_status
  INTO linked_role, linked_company_id, linked_status
  FROM public.profiles p
  WHERE p.id = NEW.profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linked profile % does not exist', NEW.profile_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF linked_role <> 'customer' THEN
    RAISE EXCEPTION 'Only customer profiles may be linked to contacts'
      USING ERRCODE = 'check_violation';
  END IF;

  IF linked_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Contact company_id must match linked profile company_id'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_validate_profile_link ON public.contacts;
CREATE TRIGGER contacts_validate_profile_link
  BEFORE INSERT OR UPDATE OF profile_id, company_id ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_contact_profile_link();

CREATE OR REPLACE FUNCTION public.enforce_single_primary_contact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_primary = true AND NEW.is_active = true THEN
    UPDATE public.contacts c
    SET is_primary = false,
        updated_at = now()
    WHERE c.company_id = NEW.company_id
      AND c.id <> NEW.id
      AND c.is_primary = true
      AND c.is_active = true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_enforce_single_primary ON public.contacts;
CREATE TRIGGER contacts_enforce_single_primary
  BEFORE INSERT OR UPDATE OF is_primary, is_active, company_id ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_single_primary_contact();

-- ---------------------------------------------------------------------------
-- 3. Link opportunities and quotes (nullable contact_id)
-- ---------------------------------------------------------------------------

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS contact_id uuid
  REFERENCES public.contacts(id) ON DELETE SET NULL;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS contact_id uuid
  REFERENCES public.contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS opportunities_contact_id_idx
  ON public.opportunities (contact_id)
  WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS quotes_contact_id_idx
  ON public.quotes (contact_id)
  WHERE contact_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_opportunity_contact_company()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  contact_company_id uuid;
BEGIN
  IF NEW.contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.company_id
  INTO contact_company_id
  FROM public.contacts c
  WHERE c.id = NEW.contact_id
    AND c.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opportunity contact must reference an active contact'
      USING ERRCODE = 'check_violation';
  END IF;

  IF contact_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Opportunity contact must belong to the same company'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunities_validate_contact ON public.opportunities;
CREATE TRIGGER opportunities_validate_contact
  BEFORE INSERT OR UPDATE OF contact_id, company_id ON public.opportunities
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_opportunity_contact_company();

CREATE OR REPLACE FUNCTION public.validate_quote_contact_company()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  contact_company_id uuid;
  opportunity_contact_id uuid;
BEGIN
  IF NEW.contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.company_id
  INTO contact_company_id
  FROM public.contacts c
  WHERE c.id = NEW.contact_id
    AND c.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote contact must reference an active contact'
      USING ERRCODE = 'check_violation';
  END IF;

  IF contact_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Quote contact must belong to the same company'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.opportunity_id IS NOT NULL THEN
    SELECT o.contact_id
    INTO opportunity_contact_id
    FROM public.opportunities o
    WHERE o.id = NEW.opportunity_id;

    IF opportunity_contact_id IS NOT NULL
       AND NEW.contact_id IS DISTINCT FROM opportunity_contact_id THEN
      RAISE EXCEPTION 'Quote contact must match linked opportunity contact when opportunity contact is set'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotes_validate_contact ON public.quotes;
CREATE TRIGGER quotes_validate_contact
  BEFORE INSERT OR UPDATE OF contact_id, company_id, opportunity_id ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_quote_contact_company();

-- ---------------------------------------------------------------------------
-- 4. Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

-- super_admin / admin: full access
CREATE POLICY "CRM admins full access to contacts"
  ON public.contacts
  FOR ALL
  TO authenticated
  USING (public.is_approved_crm_admin())
  WITH CHECK (public.is_approved_crm_admin());

-- sales: read + insert + update (deactivate via is_active, not hard delete)
CREATE POLICY "CRM sales read contacts"
  ON public.contacts
  FOR SELECT
  TO authenticated
  USING (public.is_approved_crm_staff());

CREATE POLICY "CRM sales insert contacts"
  ON public.contacts
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_approved_crm_staff());

CREATE POLICY "CRM sales update contacts"
  ON public.contacts
  FOR UPDATE
  TO authenticated
  USING (public.is_approved_crm_staff())
  WITH CHECK (public.is_approved_crm_staff());

-- production / accounts / customer: no policies → no access

COMMIT;

-- ---------------------------------------------------------------------------
-- Post-apply verification (run manually)
-- ---------------------------------------------------------------------------
--
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'contacts'
-- ORDER BY ordinal_position;
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name IN ('opportunities', 'quotes')
--   AND column_name = 'contact_id';
--
-- Notes:
-- 1. ON DELETE CASCADE on contacts.company_id deletes contacts when a company
--    is removed. Confirm this matches operational policy before applying.
-- 2. Invite/link operations should use the service role in API routes after
--    server-side permission checks (RLS alone cannot call auth.admin).
-- 3. Run docs/proposed-contacts-backfill.sql separately after app deploy.
-- 4. Existing profile, company, quote, and quote_requests RLS is unchanged.
