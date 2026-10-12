-- Checkpoint storage for a later ongoing Gmail scan.
-- Ongoing discovery stays disabled: enabled cannot be set true in this migration.
-- The applied 20261012194500 migration is unchanged.
-- This does not create supplier invoices, materials, or prices.

BEGIN;

CREATE TABLE IF NOT EXISTS public.gmail_sync_checkpoints (
  connection_id uuid PRIMARY KEY REFERENCES public.gmail_connections (id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  overlap_minutes integer NOT NULL DEFAULT 180,
  scanned_through timestamptz,
  history_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gmail_sync_checkpoints_disabled_until_approval CHECK (enabled = false),
  CONSTRAINT gmail_sync_checkpoints_overlap CHECK (
    overlap_minutes BETWEEN 30 AND 1440
  )
);

ALTER TABLE public.gmail_sync_checkpoints ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.gmail_sync_checkpoints FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.gmail_sync_checkpoints TO service_role;

COMMIT;
