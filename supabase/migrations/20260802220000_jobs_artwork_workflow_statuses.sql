-- Early artwork workflow statuses: separate customer-facing job status from artwork_source.

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_status_check;

UPDATE public.jobs
SET status = 'artwork_received'
WHERE status = 'artwork_uploaded';

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_status_check CHECK (
    status IN (
      'awaiting_artwork',
      'artwork_in_preparation',
      'artwork_received',
      'in_production',
      'ready',
      'completed',
      'cancelled'
    )
  );
