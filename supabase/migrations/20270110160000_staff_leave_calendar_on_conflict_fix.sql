-- Fix calendar enqueue ON CONFLICT for partial unique index on source_event_id (159000).
-- Test only until approved for Live.

BEGIN;

CREATE OR REPLACE FUNCTION public.staff_leave_calendar_enqueue_from_request_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req public.staff_leave_requests%ROWTYPE;
  prev_status text;
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

  IF NEW.event_type = 'approved' AND req.status = 'approved' THEN
    INSERT INTO public.staff_leave_calendar_sync_outbox (
      calendar_channel,
      operation,
      source_kind,
      source_event_id,
      leave_request_id,
      employee_profile_id
    )
    VALUES (
      'team_leave',
      'upsert',
      'leave_approved',
      NEW.id,
      req.id,
      req.profile_id
    )
    ON CONFLICT (source_event_id) WHERE source_event_id IS NOT NULL DO NOTHING;
  ELSIF NEW.event_type = 'cancelled' THEN
    prev_status := COALESCE(NEW.payload->>'previous_status', '');

    IF prev_status = 'approved' AND req.status = 'cancelled' THEN
      INSERT INTO public.staff_leave_calendar_sync_outbox (
        calendar_channel,
        operation,
        source_kind,
        source_event_id,
        leave_request_id,
        employee_profile_id
      )
      VALUES (
        'team_leave',
        'delete',
        'leave_cancelled_approved',
        NEW.id,
        req.id,
        req.profile_id
      )
      ON CONFLICT (source_event_id) WHERE source_event_id IS NOT NULL DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
