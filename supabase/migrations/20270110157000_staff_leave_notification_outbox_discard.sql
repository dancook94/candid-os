-- Allow abandoning obsolete Test notification backlog without deleting audit rows.
-- Apply on candid-os-test after 155000; do not apply on Live without approval.

BEGIN;

ALTER TABLE public.staff_leave_notification_outbox
  ADD COLUMN IF NOT EXISTS discarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS discard_reason text;

ALTER TABLE public.staff_leave_notification_outbox
  DROP CONSTRAINT IF EXISTS staff_leave_notification_outbox_status_check;

ALTER TABLE public.staff_leave_notification_outbox
  ADD CONSTRAINT staff_leave_notification_outbox_status_check
  CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'discarded'));

DROP INDEX IF EXISTS staff_leave_notification_outbox_pending_idx;

CREATE INDEX IF NOT EXISTS staff_leave_notification_outbox_pending_idx
  ON public.staff_leave_notification_outbox (status, created_at)
  WHERE status IN ('pending', 'failed', 'processing');

COMMENT ON COLUMN public.staff_leave_notification_outbox.discarded_at IS
  'When a queued notification was deliberately abandoned (notifications audit rows are retained).';

CREATE OR REPLACE FUNCTION public.staff_leave_notification_outbox_discard_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'discarded' AND OLD.status = 'sent' THEN
    RAISE EXCEPTION 'Cannot discard sent staff leave notification outbox rows.';
  END IF;

  IF NEW.status = 'discarded' AND OLD.status NOT IN ('pending', 'failed', 'processing') THEN
    RAISE EXCEPTION 'Only unsent staff leave notification outbox rows can be discarded.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_leave_notification_outbox_discard_guard_trigger
  ON public.staff_leave_notification_outbox;

CREATE TRIGGER staff_leave_notification_outbox_discard_guard_trigger
  BEFORE UPDATE ON public.staff_leave_notification_outbox
  FOR EACH ROW
  EXECUTE FUNCTION public.staff_leave_notification_outbox_discard_guard();

COMMIT;
