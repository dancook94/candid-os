-- Prepare jobs for proofing workflow: per-job proof requirement flag.
-- Apply manually in Supabase (staging first). DO NOT run automatically.
--
-- Prerequisites:
--   supabase/migrations/20260802190000_jobs_foundation.sql

BEGIN;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS proof_required boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.jobs.proof_required IS
  'When true, customer receives proof review notifications before production.';

COMMIT;
