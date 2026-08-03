-- PrintFactory matching enhancements: metadata, suggestions, stored text mappings.
-- Apply manually in Supabase. DO NOT run automatically.

BEGIN;

ALTER TABLE public.printfactory_jobs
  ADD COLUMN IF NOT EXISTS document_name text,
  ADD COLUMN IF NOT EXISTS raw_metadata jsonb,
  ADD COLUMN IF NOT EXISTS suggested_candid_job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS match_suggestion_reason text,
  ADD COLUMN IF NOT EXISTS match_suggestion_details jsonb;

ALTER TABLE public.printfactory_jobs
  DROP CONSTRAINT IF EXISTS printfactory_jobs_job_match_method_check;

ALTER TABLE public.printfactory_jobs
  ADD CONSTRAINT printfactory_jobs_job_match_method_check CHECK (
    job_match_method IS NULL OR job_match_method IN (
      'synology_path',
      'source_filename',
      'job_name',
      'document_name',
      'manual',
      'stored_mapping',
      'project_title'
    )
  );

ALTER TABLE public.printfactory_job_manifest_items
  ADD COLUMN IF NOT EXISTS suggestion_reason text,
  ADD COLUMN IF NOT EXISTS suggestion_details jsonb;

CREATE TABLE IF NOT EXISTS public.printfactory_stored_text_mappings (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mapping_type              text NOT NULL,
  pattern                   text NOT NULL,
  candid_job_id             uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  created_by_profile_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT printfactory_stored_text_mappings_type_check CHECK (
    mapping_type IN ('path_prefix', 'job_name_pattern', 'filename_pattern', 'item_reference')
  ),
  CONSTRAINT printfactory_stored_text_mappings_pattern_not_blank
    CHECK (btrim(pattern) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS printfactory_stored_text_mappings_unique_idx
  ON public.printfactory_stored_text_mappings (mapping_type, pattern);

CREATE INDEX IF NOT EXISTS printfactory_jobs_suggested_job_idx
  ON public.printfactory_jobs (suggested_candid_job_id)
  WHERE suggested_candid_job_id IS NOT NULL;

COMMIT;
