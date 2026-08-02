-- One-time repair: create jobs for accepted quotes that have no linked job.
-- Review and apply manually in Supabase after:
--   supabase/migrations/20260802190000_jobs_foundation.sql
--
-- Preferred path: POST /api/admin/quotes/{quoteId}/ensure-job
-- or click "Create missing job" on the accepted admin quote page.

-- Accepted quotes missing a job:
SELECT
  q.id AS quote_id,
  q.quote_number,
  q.project_name,
  q.company_id,
  q.opportunity_id,
  q.quote_request_id,
  q.status,
  qv.id AS quote_version_id,
  qv.accepted_at
FROM public.quotes q
JOIN public.quote_versions qv
  ON qv.quote_id = q.id
 AND qv.version_number = q.current_version
 AND qv.version_status = 'accepted'
LEFT JOIN public.jobs j ON j.quote_id = q.id
WHERE q.status = 'accepted'
  AND j.id IS NULL
ORDER BY qv.accepted_at ASC NULLS LAST;

-- Known accepted quote (Q-1) from production testing:
-- quote_id: 12ebf8dc-417a-47aa-84f4-72e625d8fede
