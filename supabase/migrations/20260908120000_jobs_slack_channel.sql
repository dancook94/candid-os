-- Slack job channel linkage (Phase 1: channel + initial summary on quote-accepted jobs).
-- Apply manually in Supabase. DO NOT run automatically.

BEGIN;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS slack_channel_id text,
  ADD COLUMN IF NOT EXISTS slack_channel_created_at timestamptz;

COMMENT ON COLUMN public.jobs.slack_channel_id IS
  'Slack channel ID (C…) for this job''s dedicated production channel.';

COMMENT ON COLUMN public.jobs.slack_channel_created_at IS
  'When the Slack job channel was first created in Slack.';

CREATE INDEX IF NOT EXISTS jobs_slack_channel_id_idx
  ON public.jobs (slack_channel_id)
  WHERE slack_channel_id IS NOT NULL;

COMMIT;
