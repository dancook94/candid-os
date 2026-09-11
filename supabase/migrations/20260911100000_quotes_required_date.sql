-- Optional production deadline on quotes (internal quotes without a quote request).
-- Apply manually in Supabase production. DO NOT run automatically from CI.

BEGIN;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS required_date date;

COMMENT ON COLUMN public.quotes.required_date IS
  'Optional production deadline for internally-created quotes. Copied to jobs.required_date on acceptance when no quote request is linked.';

COMMIT;
