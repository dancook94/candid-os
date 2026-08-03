-- PrintFactory integration sync state (singleton row).
-- Apply manually in Supabase. DO NOT run automatically.

BEGIN;

CREATE TABLE IF NOT EXISTS public.printfactory_sync_state (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton_key           text NOT NULL DEFAULT 'default',
  last_successful_sync_at timestamptz,
  last_attempted_sync_at  timestamptz,
  last_skip_cursor        integer NOT NULL DEFAULT 0,
  last_record_count       integer,
  last_error              text,
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT printfactory_sync_state_singleton_key_check
    CHECK (btrim(singleton_key) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS printfactory_sync_state_singleton_key_idx
  ON public.printfactory_sync_state (singleton_key);

ALTER TABLE public.printfactory_sync_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS printfactory_sync_state_select_crm
  ON public.printfactory_sync_state;

CREATE POLICY printfactory_sync_state_select_crm
  ON public.printfactory_sync_state
  FOR SELECT
  TO authenticated
  USING (public.is_approved_crm_staff());

DROP POLICY IF EXISTS printfactory_sync_state_update_crm
  ON public.printfactory_sync_state;

CREATE POLICY printfactory_sync_state_update_crm
  ON public.printfactory_sync_state
  FOR UPDATE
  TO authenticated
  USING (public.is_approved_crm_staff())
  WITH CHECK (public.is_approved_crm_staff());

COMMIT;
