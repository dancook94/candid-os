-- Dedicated customer notification preference for installation reports.
-- Test only. Preserves existing rows with DEFAULT true.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'contact_notification_preferences'
  ) THEN
    ALTER TABLE public.contact_notification_preferences
      ADD COLUMN IF NOT EXISTS installation_reports boolean NOT NULL DEFAULT true;
  END IF;
END;
$$;

COMMIT;
