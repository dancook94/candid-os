-- Proof lineage: version numbers are sequential per proof series, not per job.
-- Apply manually in Supabase (staging first). DO NOT run automatically.
--
-- Prerequisites:
--   supabase/migrations/20260822130000_job_proofing_phase1.sql
--   supabase/migrations/20260823140000_job_proof_files_source_and_customer_roles.sql

BEGIN;

ALTER TABLE public.job_proofs
  ADD COLUMN IF NOT EXISTS proof_lineage_id uuid;

-- ---------------------------------------------------------------------------
-- Backfill lineages from existing manifest item relationships.
--
-- Proofs on the same job with the identical manifest item set share one lineage.
-- Within each lineage, version_number is renumbered 1..N by created_at so that
-- historic job-wide version numbers (from UNIQUE(job_id, version_number)) do
-- not leave gaps or cross-lineage pollution in the new model.
-- Dropbox filenames are NOT used for this backfill.
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE proof_lineage_backfill ON COMMIT DROP AS
WITH proof_items AS (
  SELECT
    jp.id AS proof_id,
    jp.job_id,
    jp.created_at,
    COALESCE(
      (
        SELECT string_agg(link.production_item_id::text, ',' ORDER BY link.production_item_id)
        FROM public.job_proof_manifest_items AS link
        WHERE link.proof_id = jp.id
      ),
      ''
    ) AS manifest_key
  FROM public.job_proofs AS jp
),
ranked AS (
  SELECT
    proof_id,
    job_id,
    manifest_key,
    created_at,
    FIRST_VALUE(proof_id) OVER (
      PARTITION BY job_id, manifest_key
      ORDER BY created_at ASC, proof_id ASC
    ) AS lineage_root_id,
    ROW_NUMBER() OVER (
      PARTITION BY job_id, manifest_key
      ORDER BY created_at ASC, proof_id ASC
    ) AS lineage_version
  FROM proof_items
)
SELECT
  proof_id,
  lineage_root_id AS proof_lineage_id,
  lineage_version AS version_number
FROM ranked;

UPDATE public.job_proofs AS jp
SET
  proof_lineage_id = backfill.proof_lineage_id,
  version_number = backfill.version_number
FROM proof_lineage_backfill AS backfill
WHERE jp.id = backfill.proof_id;

-- Proofs without manifest links (should be rare) become their own lineage at v1.
UPDATE public.job_proofs
SET proof_lineage_id = id,
    version_number = 1
WHERE proof_lineage_id IS NULL;

ALTER TABLE public.job_proofs
  ALTER COLUMN proof_lineage_id SET NOT NULL;

DROP INDEX IF EXISTS public.job_proofs_job_version_idx;

CREATE UNIQUE INDEX IF NOT EXISTS job_proofs_lineage_version_idx
  ON public.job_proofs (proof_lineage_id, version_number);

CREATE INDEX IF NOT EXISTS job_proofs_lineage_idx
  ON public.job_proofs (proof_lineage_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_proofs_job_lineage_idx
  ON public.job_proofs (job_id, proof_lineage_id);

COMMENT ON COLUMN public.job_proofs.proof_lineage_id IS
  'Stable identifier for a proof series. All versions of the same logical proof (same manifest item set) share this UUID. version_number is sequential within the lineage.';

COMMIT;
