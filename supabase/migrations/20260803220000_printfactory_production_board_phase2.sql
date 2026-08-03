-- PrintFactory ingestion + job-led Production Board (Phase 2).
-- Apply manually in Supabase (staging first). DO NOT run automatically.
--
-- Prerequisites:
--   supabase/migrations/20260802190000_jobs_foundation.sql
--   supabase/migrations/20260803190000_production_items_foundation.sql
--   supabase/migrations/20260803200000_production_manifest_invoice_foundation.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. PrintFactory job records
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.printfactory_jobs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  printfactory_job_guid     text NOT NULL,
  job_name                  text,
  source_file_path          text,
  source_file_name          text,
  device                    text,
  media_type                text,
  producer                  text,
  printfactory_status       text,
  progress                  numeric,
  created_at_printfactory   timestamptz,
  updated_at_printfactory   timestamptz,
  first_seen_at             timestamptz NOT NULL DEFAULT now(),
  last_seen_at              timestamptz NOT NULL DEFAULT now(),
  candid_job_id             uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  job_match_status          text NOT NULL DEFAULT 'unmatched',
  job_match_method          text,
  job_match_confidence      numeric,
  extracted_job_reference   text,
  ignored_at                timestamptz,
  ignored_by_profile_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ignore_reason             text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT printfactory_jobs_guid_not_blank CHECK (btrim(printfactory_job_guid) <> ''),
  CONSTRAINT printfactory_jobs_job_match_status_check CHECK (
    job_match_status IN (
      'unmatched',
      'suggested',
      'matched_automatically',
      'matched_manually',
      'ignored',
      'conflict'
    )
  ),
  CONSTRAINT printfactory_jobs_job_match_method_check CHECK (
    job_match_method IS NULL OR job_match_method IN (
      'synology_path',
      'job_name',
      'manual',
      'stored_mapping'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS printfactory_jobs_guid_idx
  ON public.printfactory_jobs (printfactory_job_guid);

CREATE INDEX IF NOT EXISTS printfactory_jobs_candid_job_idx
  ON public.printfactory_jobs (candid_job_id, job_match_status)
  WHERE candid_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS printfactory_jobs_match_status_idx
  ON public.printfactory_jobs (job_match_status, last_seen_at DESC);

COMMENT ON TABLE public.printfactory_jobs IS
  'Synced PrintFactory jobs matched to Candid jobs via Synology path or manual review.';

-- ---------------------------------------------------------------------------
-- 2. Many-to-many PrintFactory job ↔ manifest item links
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.printfactory_job_manifest_items (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  printfactory_job_id       uuid NOT NULL REFERENCES public.printfactory_jobs(id) ON DELETE CASCADE,
  production_item_id        uuid NOT NULL REFERENCES public.production_items(id) ON DELETE CASCADE,
  link_status               text NOT NULL DEFAULT 'suggested',
  match_method              text,
  match_confidence          numeric,
  confirmed_by_profile_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  confirmed_at              timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT printfactory_job_manifest_items_link_status_check CHECK (
    link_status IN ('suggested', 'confirmed', 'rejected', 'superseded')
  ),
  CONSTRAINT printfactory_job_manifest_items_unique_link
    UNIQUE (printfactory_job_id, production_item_id)
);

CREATE INDEX IF NOT EXISTS printfactory_job_manifest_items_item_idx
  ON public.printfactory_job_manifest_items (production_item_id, link_status);

-- ---------------------------------------------------------------------------
-- 3. Stored Synology path prefix → job mappings (fallback suggestions)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.printfactory_path_prefix_mappings (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path_prefix               text NOT NULL,
  candid_job_id             uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  created_by_profile_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT printfactory_path_prefix_mappings_prefix_not_blank
    CHECK (btrim(path_prefix) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS printfactory_path_prefix_mappings_prefix_idx
  ON public.printfactory_path_prefix_mappings (path_prefix);

-- ---------------------------------------------------------------------------
-- 4. Job-led production board stage on jobs
-- ---------------------------------------------------------------------------

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS production_board_stage text NOT NULL DEFAULT 'accepted_quotes',
  ADD COLUMN IF NOT EXISTS ready_to_print_at timestamptz,
  ADD COLUMN IF NOT EXISTS production_board_on_hold boolean NOT NULL DEFAULT false;

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_production_board_stage_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_production_board_stage_check CHECK (
    production_board_stage IN (
      'accepted_quotes',
      'ready_to_print',
      'printed',
      'laminating',
      'finishing',
      'cutting',
      'dispatch',
      'complete_job',
      'on_hold'
    )
  );

COMMENT ON COLUMN public.jobs.production_board_stage IS
  'Internal job-led Production Board column. Separate from jobs.status customer workflow.';

-- Backfill accepted jobs onto the board
UPDATE public.jobs
SET production_board_stage = 'accepted_quotes'
WHERE production_board_stage IS NULL
   OR production_board_stage = '';

-- ---------------------------------------------------------------------------
-- 5. Production board stage movement history
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_production_board_stage_history (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                    uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  previous_stage            text,
  new_stage                 text NOT NULL,
  changed_by_profile_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  change_reason             text,
  is_automatic              boolean NOT NULL DEFAULT false,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_production_board_stage_history_job_idx
  ON public.job_production_board_stage_history (job_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 6. Opportunity archiving when job reaches Ready to Print
-- ---------------------------------------------------------------------------

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_reason text;

CREATE INDEX IF NOT EXISTS opportunities_archived_at_idx
  ON public.opportunities (archived_at)
  WHERE archived_at IS NOT NULL;

COMMENT ON COLUMN public.opportunities.archived_at IS
  'Soft archive when linked job moves to production. Won metrics still include archived won opportunities.';

-- ---------------------------------------------------------------------------
-- 7. Stable manifest item references per job
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS production_items_job_item_reference_idx
  ON public.production_items (job_id, item_reference)
  WHERE item_reference IS NOT NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 8. Updated-at triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.printfactory_jobs_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS printfactory_jobs_updated_at ON public.printfactory_jobs;
CREATE TRIGGER printfactory_jobs_updated_at
  BEFORE UPDATE ON public.printfactory_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.printfactory_jobs_set_updated_at();

CREATE OR REPLACE FUNCTION public.printfactory_job_manifest_items_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS printfactory_job_manifest_items_updated_at
  ON public.printfactory_job_manifest_items;
CREATE TRIGGER printfactory_job_manifest_items_updated_at
  BEFORE UPDATE ON public.printfactory_job_manifest_items
  FOR EACH ROW
  EXECUTE FUNCTION public.printfactory_job_manifest_items_set_updated_at();

ALTER TABLE public.printfactory_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.printfactory_job_manifest_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.printfactory_path_prefix_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_production_board_stage_history ENABLE ROW LEVEL SECURITY;

COMMIT;
