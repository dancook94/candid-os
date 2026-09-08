-- PrintFactory job detail source paths (Document/Location from GET /api/v2/job/{guid}).
-- Apply manually in Supabase. DO NOT run automatically.

BEGIN;

ALTER TABLE public.printfactory_jobs
  ADD COLUMN IF NOT EXISTS source_path_status text,
  ADD COLUMN IF NOT EXISTS normalized_source_path text,
  ADD COLUMN IF NOT EXISTS source_locations jsonb;

ALTER TABLE public.printfactory_jobs
  DROP CONSTRAINT IF EXISTS printfactory_jobs_source_path_status_check;

ALTER TABLE public.printfactory_jobs
  ADD CONSTRAINT printfactory_jobs_source_path_status_check CHECK (
    source_path_status IS NULL OR source_path_status IN (
      'found',
      'missing',
      'unavailable',
      'error'
    )
  );

COMMENT ON COLUMN public.printfactory_jobs.source_file_path IS
  'Raw primary Document/Location from PrintFactory job detail XML.';

COMMENT ON COLUMN public.printfactory_jobs.normalized_source_path IS
  'Normalized primary source path used for Candid job reference matching.';

COMMENT ON COLUMN public.printfactory_jobs.source_locations IS
  'JSON array of per-document source paths from PrintFactory job detail XML.';

ALTER TABLE public.printfactory_job_documents
  ADD COLUMN IF NOT EXISTS normalized_source_file_path text,
  ADD COLUMN IF NOT EXISTS source_path_status text;

ALTER TABLE public.printfactory_job_documents
  DROP CONSTRAINT IF EXISTS printfactory_job_documents_source_path_status_check;

ALTER TABLE public.printfactory_job_documents
  ADD CONSTRAINT printfactory_job_documents_source_path_status_check CHECK (
    source_path_status IS NULL OR source_path_status IN (
      'found',
      'missing',
      'unavailable',
      'error'
    )
  );

COMMIT;
