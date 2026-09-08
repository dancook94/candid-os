-- PrintFactory live-only sync state (singleton extension).
-- Apply manually in Supabase. DO NOT run automatically.
--
-- Live operational sync uses a narrow rolling window (see sync-live.ts).
-- Historical PrintFactory jobs are NOT backfilled.
--
-- Preserves legacy columns for audit (including last_skip_cursor).
-- Does NOT copy last_successful_sync_at into live_last_successful_at — the Sept 3
-- checkpoint must not drive live sync. live_last_successful_at starts NULL and is
-- set by the first successful live sync after cutover.

BEGIN;

ALTER TABLE public.printfactory_sync_state
  ADD COLUMN IF NOT EXISTS live_last_successful_at timestamptz,
  ADD COLUMN IF NOT EXISTS live_last_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS live_last_error text,
  ADD COLUMN IF NOT EXISTS live_window_capped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sync_locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS sync_lock_mode text;

ALTER TABLE public.printfactory_sync_state
  DROP CONSTRAINT IF EXISTS printfactory_sync_state_sync_lock_mode_check;

ALTER TABLE public.printfactory_sync_state
  ADD CONSTRAINT printfactory_sync_state_sync_lock_mode_check CHECK (
    sync_lock_mode IS NULL OR sync_lock_mode = 'live'
  );

COMMENT ON COLUMN public.printfactory_sync_state.live_last_successful_at IS
  'Watermark for live incremental sync — advanced only when live window is fully processed without cap.';

COMMENT ON COLUMN public.printfactory_sync_state.sync_locked_until IS
  'Expires automatically; stale locks may be taken over after recovery threshold.';

-- Migrate attempt/error state only. live_last_successful_at is intentionally omitted
-- so legacy Sept 3 last_successful_sync_at cannot seed a wide historical sync.
UPDATE public.printfactory_sync_state
SET
  live_last_attempted_at = COALESCE(live_last_attempted_at, last_attempted_sync_at),
  live_last_error = COALESCE(live_last_error, last_error)
WHERE singleton_key = 'default';

COMMIT;
