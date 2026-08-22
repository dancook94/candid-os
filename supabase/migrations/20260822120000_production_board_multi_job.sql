-- Production Board multi-job linking, PrintFactory child documents, reprint tracking.
-- Apply manually in Supabase (staging first). DO NOT run automatically.
--
-- Prerequisites:
--   supabase/migrations/20260803220000_printfactory_production_board_phase2.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. PrintFactory sheet/run ↔ multiple Candid jobs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.printfactory_job_candid_jobs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  printfactory_job_id       uuid NOT NULL REFERENCES public.printfactory_jobs(id) ON DELETE CASCADE,
  candid_job_id             uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  link_type                 text NOT NULL DEFAULT 'linked',
  is_primary                boolean NOT NULL DEFAULT false,
  linked_by_profile_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  linked_at                 timestamptz NOT NULL DEFAULT now(),
  created_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT printfactory_job_candid_jobs_link_type_check CHECK (
    link_type IN ('automatic', 'manual', 'linked', 'confirmed_multi')
  ),
  CONSTRAINT printfactory_job_candid_jobs_unique_pair
    UNIQUE (printfactory_job_id, candid_job_id)
);

CREATE INDEX IF NOT EXISTS printfactory_job_candid_jobs_job_idx
  ON public.printfactory_job_candid_jobs (candid_job_id, printfactory_job_id);

COMMENT ON TABLE public.printfactory_job_candid_jobs IS
  'Many-to-many links when one PrintFactory sheet/run contains files from multiple Candid jobs.';

-- ---------------------------------------------------------------------------
-- 2. PrintFactory child documents (from Documents[] array)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.printfactory_job_documents (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  printfactory_job_id       uuid NOT NULL REFERENCES public.printfactory_jobs(id) ON DELETE CASCADE,
  document_guid             text,
  document_name             text,
  source_file_path          text,
  source_file_name          text,
  width_mm                  numeric,
  height_mm                 numeric,
  area_sqm                  numeric,
  raw_metadata              jsonb,
  extracted_job_reference   text,
  extracted_item_reference  text,
  candid_job_id             uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  production_item_id        uuid REFERENCES public.production_items(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT printfactory_job_documents_name_or_guid CHECK (
    document_guid IS NOT NULL OR document_name IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS printfactory_job_documents_guid_idx
  ON public.printfactory_job_documents (printfactory_job_id, document_guid)
  WHERE document_guid IS NOT NULL;

CREATE INDEX IF NOT EXISTS printfactory_job_documents_pf_job_idx
  ON public.printfactory_job_documents (printfactory_job_id);

-- ---------------------------------------------------------------------------
-- 3. Reprint / unexpected file classification on PF ↔ manifest links
-- ---------------------------------------------------------------------------

ALTER TABLE public.printfactory_job_manifest_items
  ADD COLUMN IF NOT EXISTS reprint_classification text,
  ADD COLUMN IF NOT EXISTS reprint_reason text,
  ADD COLUMN IF NOT EXISTS classified_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS classified_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_possible_reprint boolean NOT NULL DEFAULT false;

ALTER TABLE public.printfactory_job_manifest_items
  DROP CONSTRAINT IF EXISTS printfactory_job_manifest_items_reprint_classification_check;

ALTER TABLE public.printfactory_job_manifest_items
  ADD CONSTRAINT printfactory_job_manifest_items_reprint_classification_check CHECK (
    reprint_classification IS NULL OR reprint_classification IN (
      'production_retry_no_charge',
      'customer_reprint_billable',
      'replacement',
      'additional_quantity',
      'ignored'
    )
  );

ALTER TABLE public.printfactory_jobs
  ADD COLUMN IF NOT EXISTS is_multi_job_sheet boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_internal_test boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.printfactory_jobs.is_multi_job_sheet IS
  'True when this PrintFactory run is linked to more than one Candid job.';

COMMIT;
