-- Proposed: customer portal settings shared records
-- Review and apply manually in Supabase. Do not auto-run from the app.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Extend public.companies with optional fields used by customer settings
-- ---------------------------------------------------------------------------

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS company_number text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS companies_set_updated_at ON public.companies;
CREATE TRIGGER companies_set_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Saved company addresses (shared admin + customer portal)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.company_addresses (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  label                 text,
  recipient_name        text,
  address_line_1        text NOT NULL,
  address_line_2        text,
  city                  text,
  county                text,
  postcode              text NOT NULL,
  country               text NOT NULL DEFAULT 'GB',
  phone                 text,
  delivery_instructions text,
  is_default_delivery   boolean NOT NULL DEFAULT false,
  is_default_billing    boolean NOT NULL DEFAULT false,
  is_active             boolean NOT NULL DEFAULT true,
  created_by            uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_addresses_line_1_not_blank CHECK (btrim(address_line_1) <> ''),
  CONSTRAINT company_addresses_postcode_not_blank CHECK (btrim(postcode) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS company_addresses_one_default_delivery_idx
  ON public.company_addresses (company_id)
  WHERE is_default_delivery = true AND is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS company_addresses_one_default_billing_idx
  ON public.company_addresses (company_id)
  WHERE is_default_billing = true AND is_active = true;

CREATE INDEX IF NOT EXISTS company_addresses_company_id_idx
  ON public.company_addresses (company_id);

DROP TRIGGER IF EXISTS company_addresses_set_updated_at ON public.company_addresses;
CREATE TRIGGER company_addresses_set_updated_at
  BEFORE UPDATE ON public.company_addresses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.company_addresses ENABLE ROW LEVEL SECURITY;

-- Admin / CRM access via existing helper functions
CREATE POLICY "Admins manage company addresses"
  ON public.company_addresses FOR ALL TO authenticated
  USING (public.is_candid_admin())
  WITH CHECK (public.is_candid_admin());

CREATE POLICY "CRM staff manage company addresses"
  ON public.company_addresses FOR ALL TO authenticated
  USING (public.is_approved_crm_staff())
  WITH CHECK (public.is_approved_crm_staff());

-- Customer read access (writes go through service-role API routes)
CREATE POLICY "Approved customers read own company addresses"
  ON public.company_addresses FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.account_status = 'approved'
        AND p.user_role = 'customer'
        AND p.company_id = company_addresses.company_id
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Contact notification preferences (shared admin + customer portal)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.contact_notification_preferences (
  contact_id                  uuid PRIMARY KEY REFERENCES public.contacts(id) ON DELETE CASCADE,
  company_id                  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  quote_received              boolean NOT NULL DEFAULT true,
  quote_reminder              boolean NOT NULL DEFAULT true,
  artwork_approval_required   boolean NOT NULL DEFAULT true,
  job_started                 boolean NOT NULL DEFAULT true,
  job_ready                   boolean NOT NULL DEFAULT true,
  job_dispatched              boolean NOT NULL DEFAULT true,
  invoice_available           boolean NOT NULL DEFAULT true,
  marketing                   boolean NOT NULL DEFAULT false,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_notification_preferences_company_id_idx
  ON public.contact_notification_preferences (company_id);

DROP TRIGGER IF EXISTS contact_notification_preferences_set_updated_at
  ON public.contact_notification_preferences;
CREATE TRIGGER contact_notification_preferences_set_updated_at
  BEFORE UPDATE ON public.contact_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.contact_notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage contact notification preferences"
  ON public.contact_notification_preferences FOR ALL TO authenticated
  USING (public.is_candid_admin())
  WITH CHECK (public.is_candid_admin());

CREATE POLICY "CRM staff read contact notification preferences"
  ON public.contact_notification_preferences FOR SELECT TO authenticated
  USING (public.is_approved_crm_staff());

CREATE POLICY "Approved customers read own notification preferences"
  ON public.contact_notification_preferences FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.contacts c
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE c.id = contact_notification_preferences.contact_id
        AND c.profile_id = p.id
        AND p.account_status = 'approved'
        AND p.user_role = 'customer'
        AND p.company_id = contact_notification_preferences.company_id
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Optional: customer read access to own contact row (SELECT only)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Approved customers read own contact" ON public.contacts;
CREATE POLICY "Approved customers read own contact"
  ON public.contacts FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.account_status = 'approved'
        AND p.user_role = 'customer'
        AND p.company_id = contacts.company_id
        AND contacts.is_active = true
    )
  );

COMMIT;

-- Notes:
-- - Customer writes to contacts/companies/addresses/preferences use server API
--   routes with the Supabase service role after ownership checks.
-- - Do not grant broad UPDATE policies on companies to customer role.
-- - Apply after confirming public.set_updated_at(), is_candid_admin(), and
--   is_approved_crm_staff() exist in your database.
