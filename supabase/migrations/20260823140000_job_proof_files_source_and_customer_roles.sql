-- Distinguish source artwork from customer-facing generated proof files.
-- Apply manually in Supabase (staging first). DO NOT run automatically.
--
-- Prerequisites:
--   supabase/migrations/20260822130000_job_proofing_phase1.sql

BEGIN;

ALTER TABLE public.job_proof_files
  ADD COLUMN IF NOT EXISTS file_role text NOT NULL DEFAULT 'customer_proof';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'job_proof_files_file_role_check'
  ) THEN
    ALTER TABLE public.job_proof_files
      ADD CONSTRAINT job_proof_files_file_role_check
      CHECK (file_role IN ('source_artwork', 'customer_proof'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS job_proof_files_proof_role_idx
  ON public.job_proof_files (proof_id, file_role);

-- Mutable proofs with a single attached file were using the attach flow as source artwork.
UPDATE public.job_proof_files AS jpf
SET file_role = 'source_artwork'
FROM public.job_proofs AS jp
WHERE jpf.proof_id = jp.id
  AND jp.status IN ('draft', 'internal_review', 'ready_to_send')
  AND jpf.file_role = 'customer_proof'
  AND NOT EXISTS (
    SELECT 1
    FROM public.job_proof_files AS other
    WHERE other.proof_id = jpf.proof_id
      AND other.id <> jpf.id
  );

ALTER TABLE public.job_proof_preflight
  ADD COLUMN IF NOT EXISTS generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS generated_dropbox_path text,
  ADD COLUMN IF NOT EXISTS generated_file_name text;

COMMENT ON COLUMN public.job_proof_files.file_role IS
  'source_artwork = internal artwork for preflight/generation; customer_proof = branded PDF sent to the customer.';

COMMIT;
