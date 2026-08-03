-- Production manifest evolution + invoice draft foundation.
-- Apply manually in Supabase (staging first). DO NOT run automatically.
--
-- Prerequisites:
--   supabase/migrations/20260802190000_jobs_foundation.sql
--   supabase/migrations/20260803190000_production_items_foundation.sql
--
-- Evolves public.production_items into the production manifest model.
-- Adds job commercial status and invoice draft tables.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Job commercial status
-- ---------------------------------------------------------------------------

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS commercial_status text NOT NULL DEFAULT 'not_ready',
  ADD COLUMN IF NOT EXISTS ready_to_print_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_to_print_override_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ready_to_print_override_reason text;

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_commercial_status_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_commercial_status_check CHECK (
    commercial_status IN (
      'not_ready',
      'invoice_review',
      'ready_for_xero',
      'pushed_to_xero',
      'invoiced'
    )
  );

COMMENT ON COLUMN public.jobs.commercial_status IS
  'Broad commercial/invoicing stage separate from production_status.';

-- ---------------------------------------------------------------------------
-- 2. Evolve production_items → production manifest items
-- ---------------------------------------------------------------------------

ALTER TABLE public.production_items
  ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quote_version_id uuid REFERENCES public.quote_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quote_item_id uuid,
  ADD COLUMN IF NOT EXISTS quoted_quantity numeric,
  ADD COLUMN IF NOT EXISTS quote_unit_price numeric,
  ADD COLUMN IF NOT EXISTS unit text,
  ADD COLUMN IF NOT EXISTS area_sqm numeric,
  ADD COLUMN IF NOT EXISTS production_requirement_status text NOT NULL DEFAULT 'required',
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'billable',
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'quoted',
  ADD COLUMN IF NOT EXISTS customer_change_reason text,
  ADD COLUMN IF NOT EXISTS internal_note text,
  ADD COLUMN IF NOT EXISTS requires_printfactory boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS printfactory_satisfied boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS combined_into_item_id uuid REFERENCES public.production_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_cancelled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.production_items
  DROP CONSTRAINT IF EXISTS production_items_production_requirement_status_check;

ALTER TABLE public.production_items
  ADD CONSTRAINT production_items_production_requirement_status_check CHECK (
    production_requirement_status IN (
      'required',
      'satisfied',
      'cancelled',
      'not_required',
      'combined',
      'external',
      'manual_production'
    )
  );

ALTER TABLE public.production_items
  DROP CONSTRAINT IF EXISTS production_items_billing_status_check;

ALTER TABLE public.production_items
  ADD CONSTRAINT production_items_billing_status_check CHECK (
    billing_status IN (
      'billable',
      'included',
      'cancelled',
      'no_charge',
      'reprint_no_charge',
      'price_required',
      'ready_to_invoice',
      'invoiced'
    )
  );

ALTER TABLE public.production_items
  DROP CONSTRAINT IF EXISTS production_items_source_type_check;

ALTER TABLE public.production_items
  ADD CONSTRAINT production_items_source_type_check CHECK (
    source_type IN (
      'quoted',
      'additional',
      'replacement',
      'reprint',
      'manual',
      'external',
      'test',
      'internal'
    )
  );

COMMENT ON TABLE public.production_items IS
  'Production manifest items: quoted, changed and additional production requirements per job.';

CREATE UNIQUE INDEX IF NOT EXISTS production_items_job_quote_item_idx
  ON public.production_items (job_id, quote_item_id)
  WHERE quote_item_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS production_items_quote_item_id_idx
  ON public.production_items (quote_item_id)
  WHERE quote_item_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS production_items_billing_status_idx
  ON public.production_items (job_id, billing_status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS production_items_requirement_status_idx
  ON public.production_items (job_id, production_requirement_status)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Invoice drafts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_invoice_drafts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  quote_id              uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  status                text NOT NULL DEFAULT 'draft',
  currency              text NOT NULL DEFAULT 'GBP',
  subtotal              numeric NOT NULL DEFAULT 0,
  tax_total             numeric NOT NULL DEFAULT 0,
  total                 numeric NOT NULL DEFAULT 0,
  purchase_order_number text,
  internal_note         text,
  approved_by           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at           timestamptz,
  xero_invoice_id       text,
  xero_invoice_number   text,
  xero_status           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT job_invoice_drafts_status_check CHECK (
    status IN (
      'draft',
      'needs_pricing',
      'ready_for_review',
      'approved',
      'pushed_to_xero',
      'invoiced',
      'cancelled'
    )
  )
);

CREATE INDEX IF NOT EXISTS job_invoice_drafts_job_id_idx
  ON public.job_invoice_drafts (job_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS job_invoice_drafts_active_job_idx
  ON public.job_invoice_drafts (job_id)
  WHERE status NOT IN ('cancelled', 'invoiced');

-- ---------------------------------------------------------------------------
-- 4. Invoice draft line items
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_invoice_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_draft_id    uuid NOT NULL REFERENCES public.job_invoice_drafts(id) ON DELETE CASCADE,
  job_id              uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  production_item_id  uuid REFERENCES public.production_items(id) ON DELETE SET NULL,
  quote_item_id       uuid,
  description         text NOT NULL,
  quantity            numeric NOT NULL DEFAULT 1,
  unit                text,
  unit_price          numeric,
  line_total          numeric NOT NULL DEFAULT 0,
  tax_rate            numeric NOT NULL DEFAULT 20,
  billing_status      text NOT NULL DEFAULT 'billable',
  pricing_source      text NOT NULL DEFAULT 'accepted_quote',
  pricing_note        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,

  CONSTRAINT job_invoice_items_description_not_blank CHECK (btrim(description) <> ''),
  CONSTRAINT job_invoice_items_billing_status_check CHECK (
    billing_status IN (
      'billable',
      'included',
      'cancelled',
      'no_charge',
      'reprint_no_charge',
      'price_required',
      'ready_to_invoice',
      'invoiced'
    )
  ),
  CONSTRAINT job_invoice_items_pricing_source_check CHECK (
    pricing_source IN (
      'accepted_quote',
      'manual',
      'calculator',
      'customer_price_rule',
      'printfactory_cost',
      'included',
      'no_charge'
    )
  )
);

CREATE INDEX IF NOT EXISTS job_invoice_items_draft_id_idx
  ON public.job_invoice_items (invoice_draft_id, created_at ASC)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS job_invoice_items_draft_production_item_idx
  ON public.job_invoice_items (invoice_draft_id, production_item_id)
  WHERE production_item_id IS NOT NULL AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.job_invoice_drafts_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS job_invoice_drafts_updated_at ON public.job_invoice_drafts;

CREATE TRIGGER job_invoice_drafts_updated_at
  BEFORE UPDATE ON public.job_invoice_drafts
  FOR EACH ROW
  EXECUTE FUNCTION public.job_invoice_drafts_set_updated_at();

CREATE OR REPLACE FUNCTION public.job_invoice_items_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS job_invoice_items_set_updated_at ON public.job_invoice_items;

CREATE TRIGGER job_invoice_items_set_updated_at
  BEFORE UPDATE ON public.job_invoice_items
  FOR EACH ROW
  EXECUTE FUNCTION public.job_invoice_items_set_updated_at();

ALTER TABLE public.job_invoice_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_invoice_items ENABLE ROW LEVEL SECURITY;

COMMIT;
