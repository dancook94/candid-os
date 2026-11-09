-- Staff Holiday cancellation (Test). Apply after staff_leave_phase1 on candid-os-test only.

BEGIN;

ALTER TABLE public.staff_leave_requests
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

COMMENT ON COLUMN public.staff_leave_requests.cancelled_at IS
  'Set when status becomes cancelled; distinct from decided_at used for approve/decline.';

COMMENT ON COLUMN public.staff_leave_requests.cancellation_reason IS
  'Reason recorded when leave is cancelled; required for management cancelling leave that has already started.';

CREATE OR REPLACE FUNCTION public.cancel_staff_leave_request(
  p_request_id uuid,
  p_cancellation_note text DEFAULT NULL
)
RETURNS public.staff_leave_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  updated_request public.staff_leave_requests;
  owner_id uuid;
  previous_status text;
  request_start date;
  request_end date;
  request_day_portion text;
  london_today date := (now() AT TIME ZONE 'Europe/London')::date;
  leave_has_started boolean;
  is_admin boolean;
  reason text := NULLIF(btrim(p_cancellation_note), '');
BEGIN
  IF actor IS NULL OR NOT public.is_approved_staff() THEN
    RAISE EXCEPTION 'Only approved staff can cancel leave requests.';
  END IF;

  is_admin := public.is_approved_candid_admin();

  SELECT r.profile_id, r.status, r.start_date, r.end_date, r.day_portion
  INTO owner_id, previous_status, request_start, request_end, request_day_portion
  FROM public.staff_leave_requests r
  WHERE r.id = p_request_id
  FOR UPDATE;

  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Leave request was not found.';
  END IF;

  IF previous_status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'Only pending or approved leave can be cancelled.';
  END IF;

  IF owner_id IS DISTINCT FROM actor AND NOT is_admin THEN
    RAISE EXCEPTION 'You can only cancel your own leave requests.';
  END IF;

  leave_has_started := previous_status = 'approved' AND request_start <= london_today;

  IF leave_has_started AND NOT is_admin THEN
    RAISE EXCEPTION 'Approved leave that has already started can only be cancelled by management.';
  END IF;

  IF leave_has_started AND is_admin AND reason IS NULL THEN
    RAISE EXCEPTION 'A cancellation reason is required when cancelling leave that has already started.';
  END IF;

  UPDATE public.staff_leave_requests r
  SET
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = actor,
    cancellation_reason = reason,
    updated_at = now()
  WHERE r.id = p_request_id
    AND r.status IN ('pending', 'approved')
  RETURNING * INTO updated_request;

  IF updated_request.id IS NULL THEN
    RAISE EXCEPTION 'Leave request is already cancelled or cannot be cancelled.';
  END IF;

  INSERT INTO public.staff_leave_request_events (request_id, event_type, actor_profile_id, payload)
  VALUES (
    updated_request.id,
    'cancelled',
    actor,
    jsonb_build_object(
      'previous_status', previous_status,
      'start_date', request_start,
      'end_date', request_end,
      'day_portion', request_day_portion,
      'days_requested', updated_request.days_requested,
      'cancellation_reason', reason,
      'cancelled_at', updated_request.cancelled_at,
      'cancelled_by', actor,
      'cancelled_on_behalf', owner_id IS DISTINCT FROM actor,
      'london_today', london_today,
      'leave_had_started', leave_has_started,
      'notify_email', false,
      'remove_google_calendar_event', false
    )
  );

  RETURN updated_request;
END;
$$;

COMMENT ON FUNCTION public.cancel_staff_leave_request(uuid, text) IS
  'Staff may cancel own pending leave or future approved leave. Management may cancel any pending/approved leave; a reason is required once approved leave has started (Europe/London). Email and Google Calendar hooks are reserved in the audit payload.';

GRANT EXECUTE ON FUNCTION public.cancel_staff_leave_request(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_staff_leave_request(uuid, text) FROM PUBLIC, anon;

COMMIT;
