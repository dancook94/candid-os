-- Extend job_proof_preflight for Proof Generator Phase 1.
-- Apply manually in Supabase (staging first). DO NOT run automatically.
--
-- Prerequisites:
--   supabase/migrations/20260822130000_job_proofing_phase1.sql

BEGIN;

ALTER TABLE public.job_proof_preflight
  ADD COLUMN IF NOT EXISTS source_dropbox_path text,
  ADD COLUMN IF NOT EXISTS analysis_version text,
  ADD COLUMN IF NOT EXISTS overall_status text,
  ADD COLUMN IF NOT EXISTS detected_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS manual_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reviewed_by_profile_id uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'job_proof_preflight_reviewed_by_profile_id_fkey'
  ) THEN
    ALTER TABLE public.job_proof_preflight
      ADD CONSTRAINT job_proof_preflight_reviewed_by_profile_id_fkey
      FOREIGN KEY (reviewed_by_profile_id)
      REFERENCES public.profiles(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.job_proof_preflight.overall_status IS
  'Automated preflight summary: pass, warning, or manual_review.';

COMMIT;
