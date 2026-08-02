-- Structured classification for automated CRM tasks such as quote follow-ups.
-- Apply manually in Supabase. Do not auto-run from the app.
--
-- After apply, automated quote follow-up tasks store automation_key = 'quote_follow_up'
-- and auto-complete matches on quote_id + automation_key.

BEGIN;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS automation_key text;

CREATE INDEX IF NOT EXISTS tasks_automation_key_idx
  ON public.tasks (automation_key)
  WHERE automation_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_quote_follow_up_open_idx
  ON public.tasks (quote_id, status)
  WHERE automation_key = 'quote_follow_up'
    AND status IN ('open', 'in_progress');

COMMENT ON COLUMN public.tasks.automation_key IS
  'Stable automation identifier, e.g. quote_follow_up for sent-quote follow-up tasks.';

COMMIT;
