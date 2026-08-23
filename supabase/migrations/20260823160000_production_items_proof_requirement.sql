-- Item-level proof requirements on production manifest items.
-- Apply manually in Supabase (staging first). DO NOT run automatically.

BEGIN;

ALTER TABLE public.production_items
  ADD COLUMN IF NOT EXISTS proof_requirement text;

ALTER TABLE public.production_items
  DROP CONSTRAINT IF EXISTS production_items_proof_requirement_check;

ALTER TABLE public.production_items
  ADD CONSTRAINT production_items_proof_requirement_check
  CHECK (
    proof_requirement IS NULL
    OR proof_requirement IN ('pending', 'required', 'not_required', 'not_applicable')
  );

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS proof_requirements_confirmed_at timestamptz;

COMMENT ON COLUMN public.production_items.proof_requirement IS
  'Per manifest item: pending (awaiting staff decision), required, not_required, not_applicable.';

COMMENT ON COLUMN public.jobs.proof_requirements_confirmed_at IS
  'When Candid staff confirmed proof requirement selections for all proofable manifest items.';

-- Backfill active manifest items from existing job-level proof_required and item type.
UPDATE public.production_items pi
SET proof_requirement = CASE
  WHEN pi.deleted_at IS NOT NULL OR pi.combined_into_item_id IS NOT NULL THEN NULL
  WHEN pi.production_requirement_status <> 'required' THEN 'not_applicable'
  WHEN lower(pi.item_name) LIKE ANY (ARRAY[
    '%delivery%',
    '%installation%',
    '%install%',
    '%survey%',
    '%design time%',
    '%design fee%',
    '%project management%',
    '%site visit%',
    '%consultancy%',
    '%consultation%'
  ]) THEN 'not_applicable'
  WHEN EXISTS (
    SELECT 1
    FROM public.jobs j
    WHERE j.id = pi.job_id
      AND j.proof_required = false
  ) THEN 'not_required'
  ELSE 'required'
END
WHERE pi.proof_requirement IS NULL;

-- Existing jobs with manifest items already in use: treat requirements as confirmed.
UPDATE public.jobs j
SET proof_requirements_confirmed_at = COALESCE(j.proof_requirements_confirmed_at, now())
WHERE proof_requirements_confirmed_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.production_items pi
    WHERE pi.job_id = j.id
      AND pi.deleted_at IS NULL
      AND pi.combined_into_item_id IS NULL
  );

COMMIT;
