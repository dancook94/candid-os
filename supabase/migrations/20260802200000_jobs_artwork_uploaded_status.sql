-- Add artwork_uploaded to jobs.status for completed customer artwork uploads.

BEGIN;

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_status_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_status_check CHECK (
    status IN (
      'awaiting_artwork',
      'artwork_uploaded',
      'in_production',
      'ready',
      'completed',
      'cancelled'
    )
  );

COMMIT;
