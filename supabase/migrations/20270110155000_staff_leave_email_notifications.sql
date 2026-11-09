-- Staff leave email notifications (Test). Enqueue from authoritative leave audit events.
-- Apply on candid-os-test after staff_leave_admin_booking; do not apply on Live without approval.

BEGIN;

CREATE TABLE IF NOT EXISTS public.staff_leave_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_event_id uuid NOT NULL REFERENCES public.staff_leave_request_events (id) ON DELETE CASCADE,
  notification_kind text NOT NULL,
  request_id uuid NOT NULL REFERENCES public.staff_leave_requests (id) ON DELETE CASCADE,
  employee_profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  processed_at timestamptz,
  CONSTRAINT staff_leave_notification_outbox_source_event_id_key UNIQUE (source_event_id),
  CONSTRAINT staff_leave_notification_outbox_status_check
    CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  CONSTRAINT staff_leave_notification_outbox_kind_check
    CHECK (
      notification_kind IN (
        'management_annual_submitted',
        'management_additional_paid_submitted',
        'employee_approved',
        'employee_declined',
        'management_approved_cancelled',
        'employee_additional_paid_granted'
      )
    )
);

CREATE INDEX IF NOT EXISTS staff_leave_notification_outbox_pending_idx
  ON public.staff_leave_notification_outbox (status, created_at)
  WHERE status IN ('pending', 'failed');

COMMENT ON TABLE public.staff_leave_notification_outbox IS
  'Durable queue for staff leave emails; one row per staff_leave_request_events row that should notify.';

CREATE OR REPLACE FUNCTION public.staff_leave_notification_enqueue_from_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req public.staff_leave_requests%ROWTYPE;
  kind text;
  granted_by_admin boolean;
BEGIN
  SELECT * INTO req
  FROM public.staff_leave_requests r
  WHERE r.id = NEW.request_id;

  IF req.id IS NULL THEN
    RETURN NEW;
  END IF;

  IF req.leave_kind NOT IN ('annual', 'additional_paid') THEN
    RETURN NEW;
  END IF;

  granted_by_admin := COALESCE((NEW.payload->>'granted_by_admin')::boolean, false);

  IF NEW.event_type = 'submitted' THEN
    IF granted_by_admin AND req.leave_kind = 'additional_paid' THEN
      kind := 'employee_additional_paid_granted';
    ELSIF req.leave_kind = 'annual' THEN
      kind := 'management_annual_submitted';
    ELSIF req.leave_kind = 'additional_paid' THEN
      kind := 'management_additional_paid_submitted';
    END IF;
  ELSIF NEW.event_type = 'approved' THEN
    IF EXISTS (
      SELECT 1
      FROM public.staff_leave_request_events e
      WHERE e.request_id = NEW.request_id
        AND e.event_type = 'submitted'
        AND COALESCE((e.payload->>'granted_by_admin')::boolean, false) = true
    ) THEN
      NULL;
    ELSE
      kind := 'employee_approved';
    END IF;
  ELSIF NEW.event_type = 'rejected' THEN
    kind := 'employee_declined';
  ELSIF NEW.event_type = 'cancelled' THEN
    IF COALESCE(NEW.payload->>'previous_status', '') = 'approved' THEN
      kind := 'management_approved_cancelled';
    END IF;
  END IF;

  IF kind IS NOT NULL THEN
    INSERT INTO public.staff_leave_notification_outbox (
      source_event_id,
      notification_kind,
      request_id,
      employee_profile_id
    )
    VALUES (
      NEW.id,
      kind,
      NEW.request_id,
      req.profile_id
    )
    ON CONFLICT (source_event_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_leave_notification_enqueue_trigger
  ON public.staff_leave_request_events;

CREATE TRIGGER staff_leave_notification_enqueue_trigger
  AFTER INSERT ON public.staff_leave_request_events
  FOR EACH ROW
  EXECUTE FUNCTION public.staff_leave_notification_enqueue_from_event();

ALTER TABLE public.staff_leave_notification_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.staff_leave_notification_outbox FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.staff_leave_notification_outbox TO service_role;

-- Extend notification settings JSON with staff leave routing (emails configured in admin UI).
UPDATE public.notification_settings
SET
  settings = settings
    || jsonb_build_object(
      'recipientGroups',
      COALESCE(settings->'recipientGroups', '{}'::jsonb)
        || jsonb_build_object(
          'staff_leave_management',
          COALESCE(settings->'recipientGroups'->'staff_leave_management', '[]'::jsonb)
        )
    )
    || jsonb_build_object(
      'routing',
      COALESCE(settings->'routing', '{}'::jsonb)
        || jsonb_build_object(
          'internal_staff_leave_annual_request',
          jsonb_build_array('staff_leave_management'),
          'internal_staff_leave_additional_paid_request',
          jsonb_build_array('staff_leave_management'),
          'internal_staff_leave_cancelled_approved',
          jsonb_build_array('staff_leave_management')
        )
    )
    || jsonb_build_object(
      'internal',
      COALESCE(settings->'internal', '{}'::jsonb)
        || jsonb_build_object(
          'internal_staff_leave_annual_request', true,
          'internal_staff_leave_additional_paid_request', true,
          'internal_staff_leave_cancelled_approved', true
        )
    ),
  updated_at = now()
WHERE singleton_key = 'default';

COMMIT;
