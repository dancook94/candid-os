-- Admin-controlled artwork source for jobs (customer_pending, portal_upload, manual_receipt, candid_creating)

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS artwork_source text NOT NULL DEFAULT 'customer_pending';

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_artwork_source_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_artwork_source_check CHECK (
    artwork_source IN (
      'customer_pending',
      'portal_upload',
      'manual_receipt',
      'candid_creating'
    )
  );

-- Jobs with completed portal uploads should reflect portal_upload as the source.
UPDATE public.jobs AS j
SET artwork_source = 'portal_upload'
WHERE EXISTS (
  SELECT 1
  FROM public.job_files AS f
  WHERE f.job_id = j.id
    AND f.deleted_at IS NULL
    AND f.upload_status = 'complete'
);
