-- Proof lineage: version numbers are sequential per proof series, not per job.
-- Apply manually in Supabase SQL Editor (staging first). DO NOT run automatically.
--
-- Prerequisites:
--   supabase/migrations/20260822130000_job_proofing_phase1.sql
--   supabase/migrations/20260823140000_job_proof_files_source_and_customer_roles.sql
--
-- ORDER (required):
--   A. add proof_lineage_id
--   B. drop legacy UNIQUE (job_id, version_number)
--   C-D. backfill lineages + repair version_number per lineage
--   E. NOT NULL on proof_lineage_id
--   F. UNIQUE (proof_lineage_id, version_number)
--
-- Legacy index definition (20260822130000_job_proofing_phase1.sql):
--   CREATE UNIQUE INDEX job_proofs_job_version_idx
--     ON public.job_proofs (job_id, version_number);
--
-- Manual diagnostics (run separately before/after if needed):
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE schemaname = 'public' AND tablename = 'job_proofs'
--     AND indexname IN ('job_proofs_job_version_idx', 'job_proofs_lineage_version_idx');
--   SELECT COUNT(*) AS proof_rows FROM public.job_proofs;
--   SELECT proof_lineage_id, version_number, COUNT(*) AS row_count
--   FROM public.job_proofs
--   GROUP BY proof_lineage_id, version_number
--   HAVING COUNT(*) > 1;

BEGIN;

-- A. Add proof_lineage_id column (idempotent)
ALTER TABLE public.job_proofs
  ADD COLUMN IF NOT EXISTS proof_lineage_id uuid;

-- B. Drop legacy unique index BEFORE any backfill that allows multiple v1 rows per job
DROP INDEX IF EXISTS public.job_proofs_job_version_idx;

-- C-D. Backfill proof_lineage_id from manifest item relationships, then repair version_number
--
-- Lineage rules:
-- - Same job + identical manifest item set => same lineage (earliest proof id wins)
-- - No manifest links => separate lineage per proof (proof_lineage_id = id)
-- - Dropbox "(1)" suffixes are NOT used
UPDATE public.job_proofs AS jp
SET proof_lineage_id = assign.proof_lineage_id
FROM (
  WITH proof_items AS (
    SELECT
      jp_inner.id AS proof_id,
      jp_inner.job_id,
      jp_inner.created_at,
      (
        SELECT string_agg(link.production_item_id::text, ',' ORDER BY link.production_item_id)
        FROM public.job_proof_manifest_items AS link
        WHERE link.proof_id = jp_inner.id
      ) AS manifest_key,
      (
        SELECT COUNT(*)
        FROM public.job_proof_manifest_items AS link
        WHERE link.proof_id = jp_inner.id
      ) AS manifest_item_count
    FROM public.job_proofs AS jp_inner
  ),
  grouped_proofs AS (
    SELECT *
    FROM proof_items
    WHERE manifest_item_count > 0
  ),
  lineage_roots AS (
    SELECT DISTINCT ON (job_id, manifest_key)
      job_id,
      manifest_key,
      proof_id AS lineage_root_id
    FROM grouped_proofs
    ORDER BY job_id, manifest_key, created_at ASC, proof_id ASC
  )
  SELECT
    gp.proof_id,
    lr.lineage_root_id AS proof_lineage_id
  FROM grouped_proofs AS gp
  INNER JOIN lineage_roots AS lr
    ON lr.job_id = gp.job_id
   AND lr.manifest_key = gp.manifest_key
) AS assign
WHERE jp.id = assign.proof_id;

-- Proofs without manifest links: own lineage (do not merge ambiguous orphans)
UPDATE public.job_proofs
SET proof_lineage_id = id
WHERE proof_lineage_id IS NULL;

-- Repair version_number within each lineage (1..N by created_at / sent_at)
-- Example broken data in one lineage: v1, v1, v1 => v1, v2, v3
UPDATE public.job_proofs AS jp
SET version_number = repair.version_number
FROM (
  SELECT
    jp_inner.id AS proof_id,
    ROW_NUMBER() OVER (
      PARTITION BY jp_inner.proof_lineage_id
      ORDER BY
        jp_inner.created_at ASC,
        COALESCE(jp_inner.sent_at, jp_inner.created_at) ASC,
        jp_inner.id ASC
    )::integer AS version_number
  FROM public.job_proofs AS jp_inner
) AS repair
WHERE jp.id = repair.proof_id;

-- E. Require proof_lineage_id on all rows
ALTER TABLE public.job_proofs
  ALTER COLUMN proof_lineage_id SET NOT NULL;

-- F. New uniqueness: one version number per proof lineage
-- (Fails with 23505 if duplicate pairs remain; run diagnostic query above to inspect.)
CREATE UNIQUE INDEX IF NOT EXISTS job_proofs_lineage_version_idx
  ON public.job_proofs (proof_lineage_id, version_number);

-- G. Supporting indexes
CREATE INDEX IF NOT EXISTS job_proofs_lineage_idx
  ON public.job_proofs (proof_lineage_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_proofs_job_lineage_idx
  ON public.job_proofs (job_id, proof_lineage_id);

COMMENT ON COLUMN public.job_proofs.proof_lineage_id IS
  'Stable identifier for a proof series. All versions of the same logical proof (same manifest item set) share this UUID. version_number is sequential within the lineage.';

COMMIT;
