-- Phase 1 notification system (Resend email delivery, preferences, admin settings).
-- Apply manually in Supabase. DO NOT run automatically.

BEGIN;

CREATE TABLE IF NOT EXISTS public.notifications (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type       text NOT NULL,
  channel                 text NOT NULL DEFAULT 'email',
  audience                text NOT NULL,
  company_id              uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  contact_id              uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  profile_id              uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  job_id                  uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  quote_id                uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  quote_request_id        uuid REFERENCES public.quote_requests(id) ON DELETE SET NULL,
  opportunity_id          uuid REFERENCES public.opportunities(id) ON DELETE SET NULL,
  production_item_id      uuid,
  invoice_draft_id        uuid REFERENCES public.job_invoice_drafts(id) ON DELETE SET NULL,
  recipient_email         text,
  intended_recipient_email text,
  subject                 text,
  template_key            text,
  status                  text NOT NULL DEFAULT 'pending',
  provider                text,
  provider_message_id     text,
  error_message           text,
  metadata                jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key         text,
  scheduled_for           timestamptz,
  sent_at                 timestamptz,
  delivered_at            timestamptz,
  failed_at               timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notifications_channel_check
    CHECK (channel IN ('email', 'slack', 'portal')),
  CONSTRAINT notifications_audience_check
    CHECK (audience IN ('customer', 'staff', 'internal')),
  CONSTRAINT notifications_status_check
    CHECK (status IN (
      'pending', 'suppressed', 'sending', 'sent', 'delivered',
      'failed', 'bounced', 'cancelled'
    ))
);

CREATE INDEX IF NOT EXISTS notifications_created_at_idx
  ON public.notifications (created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_status_idx
  ON public.notifications (status);

CREATE INDEX IF NOT EXISTS notifications_type_idx
  ON public.notifications (notification_type);

CREATE INDEX IF NOT EXISTS notifications_job_id_idx
  ON public.notifications (job_id)
  WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_quote_id_idx
  ON public.notifications (quote_id)
  WHERE quote_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_idempotency_key_idx
  ON public.notifications (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type        text NOT NULL,
  company_id        uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  contact_id        uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  profile_id        uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  email_enabled     boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notification_preferences_scope_check
    CHECK (scope_type IN ('global', 'company', 'contact', 'staff'))
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_global_type_idx
  ON public.notification_preferences (notification_type)
  WHERE scope_type = 'global';

CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_contact_type_idx
  ON public.notification_preferences (contact_id, notification_type)
  WHERE scope_type = 'contact' AND contact_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.notification_settings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton_key text NOT NULL DEFAULT 'default',
  settings      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notification_settings_singleton_key_check
    CHECK (btrim(singleton_key) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_settings_singleton_key_idx
  ON public.notification_settings (singleton_key);

INSERT INTO public.notification_settings (singleton_key, settings)
VALUES ('default', '{}'::jsonb)
ON CONFLICT DO NOTHING;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select_crm ON public.notifications;
CREATE POLICY notifications_select_crm
  ON public.notifications FOR SELECT TO authenticated
  USING (public.is_approved_crm_staff());

DROP POLICY IF EXISTS notification_preferences_select_crm ON public.notification_preferences;
CREATE POLICY notification_preferences_select_crm
  ON public.notification_preferences FOR SELECT TO authenticated
  USING (public.is_approved_crm_staff());

DROP POLICY IF EXISTS notification_settings_select_crm ON public.notification_settings;
CREATE POLICY notification_settings_select_crm
  ON public.notification_settings FOR SELECT TO authenticated
  USING (public.is_approved_crm_staff());

DROP POLICY IF EXISTS notification_settings_update_admin ON public.notification_settings;
CREATE POLICY notification_settings_update_admin
  ON public.notification_settings FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.account_status = 'approved'
        AND p.user_role IN ('super_admin', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.account_status = 'approved'
        AND p.user_role IN ('super_admin', 'admin')
    )
  );

COMMIT;
