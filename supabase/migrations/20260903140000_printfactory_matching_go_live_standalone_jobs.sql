-- PrintFactory matching go-live support + standalone jobs (internal / FOC / PF-created).
-- Apply manually in Supabase. DO NOT run automatically.
--
-- Prerequisites:
--   supabase/migrations/20260802190000_jobs_foundation.sql
--   supabase/migrations/20260803200000_production_manifest_invoice_foundation.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Standalone jobs without a quote
-- ---------------------------------------------------------------------------

ALTER TABLE public.jobs
  ALTER COLUMN quote_id DROP NOT NULL;

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_one_per_quote;

CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_per_quote_idx
  ON public.jobs (quote_id)
  WHERE quote_id IS NOT NULL;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS job_billing_type text NOT NULL DEFAULT 'billable',
  ADD COLUMN IF NOT EXISTS job_origin text NOT NULL DEFAULT 'quote',
  ADD COLUMN IF NOT EXISTS internal_notes text;

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_job_billing_type_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_job_billing_type_check CHECK (
    job_billing_type IN ('billable', 'non_billable', 'internal')
  );

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_job_origin_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_job_origin_check CHECK (
    job_origin IN ('quote', 'printfactory', 'manual')
  );

COMMENT ON COLUMN public.jobs.job_billing_type IS
  'billable = normal customer work; non_billable = FOC customer work; internal = Candid production.';

COMMENT ON COLUMN public.jobs.job_origin IS
  'quote = created from accepted quote; printfactory = created from PrintFactory; manual = staff-created.';

-- ---------------------------------------------------------------------------
-- 2. Invoice exclusion for internal / non-billable jobs
-- ---------------------------------------------------------------------------

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_commercial_status_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_commercial_status_check CHECK (
    commercial_status IN (
      'not_ready',
      'invoice_review',
      'ready_for_xero',
      'pushed_to_xero',
      'invoiced',
      'not_invoiceable'
    )
  );

COMMIT;
