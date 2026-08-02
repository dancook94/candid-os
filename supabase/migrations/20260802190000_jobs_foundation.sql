-- Jobs foundation: customer-visible production jobs and artwork file metadata.
-- Applied via scripts/apply-jobs-migration.mjs or Supabase SQL editor.

BEGIN;

CREATE TABLE IF NOT EXISTS public.jobs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  quote_id              uuid NOT NULL REFERENCES public.quotes(id) ON DELETE RESTRICT,
  quote_version_id      uuid REFERENCES public.quote_versions(id) ON DELETE SET NULL,
  opportunity_id        uuid REFERENCES public.opportunities(id) ON DELETE SET NULL,
  quote_request_id      uuid REFERENCES public.quote_requests(id) ON DELETE SET NULL,
  contact_id            uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  job_reference         text NOT NULL,
  project_name          text NOT NULL,
  status                text NOT NULL DEFAULT 'awaiting_artwork',
  fulfilment_method     text,
  required_date         date,
  artwork_required      boolean NOT NULL DEFAULT true,
  customer_visible      boolean NOT NULL DEFAULT true,
  accepted_at           timestamptz,
  accepted_by           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  dropbox_folder_path   text,
  dropbox_folder_id     text,
  dropbox_setup_status  text NOT NULL DEFAULT 'pending',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT jobs_job_reference_not_blank CHECK (btrim(job_reference) <> ''),
  CONSTRAINT jobs_project_name_not_blank CHECK (btrim(project_name) <> ''),
  CONSTRAINT jobs_status_check CHECK (
    status IN (
      'awaiting_artwork',
      'artwork_uploaded',
      'in_production',
      'ready',
      'completed',
      'cancelled'
    )
  ),
  CONSTRAINT jobs_dropbox_setup_status_check CHECK (
    dropbox_setup_status IN ('pending', 'ready', 'failed')
  ),
  CONSTRAINT jobs_one_per_quote UNIQUE (quote_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_job_reference_idx
  ON public.jobs (job_reference);

CREATE INDEX IF NOT EXISTS jobs_company_id_idx
  ON public.jobs (company_id, updated_at DESC)
  WHERE customer_visible = true;

CREATE INDEX IF NOT EXISTS jobs_status_idx
  ON public.jobs (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.job_files (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                    uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id                uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  uploaded_by_profile_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  file_name                 text NOT NULL,
  original_file_name        text NOT NULL,
  file_extension            text NOT NULL,
  mime_type                 text,
  file_size_bytes           bigint NOT NULL DEFAULT 0,
  dropbox_file_id           text,
  dropbox_path_lower        text,
  dropbox_revision          text,
  content_hash              text,
  dropbox_upload_session_id text,
  upload_session_offset     bigint,
  upload_status             text NOT NULL DEFAULT 'pending',
  artwork_status            text NOT NULL DEFAULT 'uploaded',
  customer_notes            text,
  internal_notes            text,
  version_number            integer NOT NULL DEFAULT 1,
  supersedes_file_id        uuid REFERENCES public.job_files(id) ON DELETE SET NULL,
  uploaded_at               timestamptz,
  reviewed_at               timestamptz,
  approved_at               timestamptz,
  approved_by_profile_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  changes_required_comment  text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz,
  deleted_by                uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  CONSTRAINT job_files_file_name_not_blank CHECK (btrim(file_name) <> ''),
  CONSTRAINT job_files_original_file_name_not_blank CHECK (btrim(original_file_name) <> ''),
  CONSTRAINT job_files_extension_not_blank CHECK (btrim(file_extension) <> ''),
  CONSTRAINT job_files_size_non_negative CHECK (file_size_bytes >= 0),
  CONSTRAINT job_files_version_positive CHECK (version_number >= 1),
  CONSTRAINT job_files_upload_status_check CHECK (
    upload_status IN ('pending', 'uploading', 'processing', 'complete', 'failed', 'cancelled')
  ),
  CONSTRAINT job_files_artwork_status_check CHECK (
    artwork_status IN (
      'uploaded',
      'under_review',
      'changes_required',
      'approved',
      'superseded'
    )
  ),
  CONSTRAINT job_files_changes_required_comment CHECK (
    artwork_status <> 'changes_required'
    OR (changes_required_comment IS NOT NULL AND btrim(changes_required_comment) <> '')
  )
);

CREATE INDEX IF NOT EXISTS job_files_job_id_idx
  ON public.job_files (job_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS job_files_company_id_idx
  ON public.job_files (company_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS job_files_dropbox_path_lower_idx
  ON public.job_files (dropbox_path_lower)
  WHERE dropbox_path_lower IS NOT NULL AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS jobs_set_updated_at ON public.jobs;
CREATE TRIGGER jobs_set_updated_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_files ENABLE ROW LEVEL SECURITY;

COMMIT;
