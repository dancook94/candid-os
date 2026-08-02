-- Proposed migration: Candid OS application settings (singleton row)
-- Review and apply manually in Supabase. Do not run automatically from the app.

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true,
  CONSTRAINT app_settings_singleton_unique UNIQUE (singleton),
  CONSTRAINT app_settings_singleton_check CHECK (singleton = true),

  company_name text NOT NULL DEFAULT 'Candid Creative Limited',
  address_line_1 text,
  address_line_2 text,
  address_city text,
  address_postcode text,
  telephone text,
  website text,
  company_number text,
  vat_number text,
  accounts_email text,
  quote_email_sender_name text,
  quote_email_sender_address text,

  default_payment_terms_days integer NOT NULL DEFAULT 14
    CONSTRAINT app_settings_payment_terms_check
    CHECK (default_payment_terms_days >= 0 AND default_payment_terms_days <= 365),
  default_quote_expiry_days integer NOT NULL DEFAULT 30
    CONSTRAINT app_settings_expiry_days_check
    CHECK (default_quote_expiry_days >= 0 AND default_quote_expiry_days <= 365),
  default_vat_rate numeric(6, 4) NOT NULL DEFAULT 0.2000
    CONSTRAINT app_settings_vat_rate_check
    CHECK (default_vat_rate >= 0 AND default_vat_rate <= 1),
  default_introduction text,
  default_customer_notes text,
  quote_number_prefix text NOT NULL DEFAULT 'Q-',
  show_product_images_by_default boolean NOT NULL DEFAULT true,

  accent_colour text NOT NULL DEFAULT '#fbd12c',

  default_company_payment_terms_days integer NOT NULL DEFAULT 14
    CONSTRAINT app_settings_company_payment_terms_check
    CHECK (default_company_payment_terms_days >= 0 AND default_company_payment_terms_days <= 365),
  default_registration_account_status text NOT NULL DEFAULT 'pending'
    CONSTRAINT app_settings_registration_status_check
    CHECK (default_registration_account_status IN ('pending', 'approved')),
  default_deadline_status text NOT NULL DEFAULT 'pending'
    CONSTRAINT app_settings_deadline_status_check
    CHECK (default_deadline_status IN ('pending', 'approved')),

  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id)
);

INSERT INTO public.app_settings (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved admins can read app settings"
  ON public.app_settings
  FOR SELECT
  TO authenticated
  USING (public.is_candid_admin());

CREATE POLICY "Super admins can update app settings"
  ON public.app_settings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.user_role = 'super_admin'
        AND p.account_status = 'approved'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.user_role = 'super_admin'
        AND p.account_status = 'approved'
    )
  );

COMMIT;

-- Optional follow-up (separate migration): wire registration trigger to
-- app_settings.default_registration_account_status for new self-registrations.
