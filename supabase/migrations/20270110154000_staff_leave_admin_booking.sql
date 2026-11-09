-- Admin submission of annual leave on behalf of an employee (pending approval).
-- Does not auto-approve; preserves decide_staff_leave_request self-decision rule.

CREATE OR REPLACE FUNCTION public.submit_staff_leave_request_for_profile(
  p_profile_id uuid,
  p_start_date date,
  p_end_date date,
  p_day_portion text,
  p_employee_note text DEFAULT NULL
)
RETURNS public.staff_leave_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn_submit_for_profile$
DECLARE
  actor uuid := auth.uid();
  new_request public.staff_leave_requests;
  days numeric;
  bal record;
  hy integer := EXTRACT(YEAR FROM p_start_date)::integer;
BEGIN
  IF actor IS NULL OR NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Only approved admins can submit leave on behalf of an employee.';
  END IF;

  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_id is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_profile_id
      AND p.account_status = 'approved'
      AND p.user_role IN ('super_admin', 'admin', 'sales', 'production', 'accounts')
  ) THEN
    RAISE EXCEPTION 'Leave can only be booked for approved staff.';
  END IF;

  PERFORM public.staff_leave_lock_profile(p_profile_id);

  IF hy < 2027 THEN
    RAISE EXCEPTION 'Leave requests are available from 2027.';
  END IF;

  IF EXTRACT(YEAR FROM p_end_date)::integer <> hy THEN
    RAISE EXCEPTION 'A single request cannot cross holiday years.';
  END IF;

  IF p_day_portion NOT IN ('full', 'am', 'pm') THEN
    RAISE EXCEPTION 'Invalid day portion.';
  END IF;

  days := public.staff_leave_count_request_days(p_profile_id, p_start_date, p_end_date, p_day_portion);
  IF days <= 0 THEN
    RAISE EXCEPTION 'The selected dates do not include any bookable working days.';
  END IF;

  IF public.staff_leave_has_blocking_overlap(p_profile_id, p_start_date, p_end_date, NULL) THEN
    RAISE EXCEPTION 'These dates overlap existing annual or additional paid leave.';
  END IF;

  SELECT * INTO bal FROM public.staff_leave_balance(p_profile_id, hy);

  IF bal.remaining_days - days < 0 THEN
    RAISE EXCEPTION 'Insufficient remaining leave balance.';
  END IF;

  INSERT INTO public.staff_leave_requests (
    profile_id, holiday_year, leave_kind, status,
    start_date, end_date, day_portion, days_requested, employee_note
  )
  VALUES (
    p_profile_id, hy, 'annual', 'pending',
    p_start_date, p_end_date, p_day_portion, days,
    NULLIF(btrim(p_employee_note), '')
  )
  RETURNING * INTO new_request;

  INSERT INTO public.staff_leave_request_events (request_id, event_type, actor_profile_id, payload)
  VALUES (
    new_request.id,
    'submitted',
    actor,
    jsonb_build_object(
      'leave_kind', 'annual',
      'days_requested', days,
      'day_portion', p_day_portion,
      'submitted_on_behalf', true,
      'employee_profile_id', p_profile_id
    )
  );

  RETURN new_request;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'These dates overlap existing annual or additional paid leave.';
END;
$fn_submit_for_profile$;

GRANT EXECUTE ON FUNCTION public.submit_staff_leave_request_for_profile(uuid, date, date, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.submit_staff_leave_request_for_profile(uuid, date, date, text, text) FROM PUBLIC, anon;

-- Authoritative working-day count for booking UI (patterns, bank holidays, closures).
CREATE OR REPLACE FUNCTION public.preview_staff_leave_request_days(
  target_profile uuid,
  p_start_date date,
  p_end_date date,
  p_day_portion text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn_preview_days$
BEGIN
  PERFORM public.staff_leave_assert_profile_access(target_profile);

  IF p_day_portion NOT IN ('full', 'am', 'pm') THEN
    RAISE EXCEPTION 'Invalid day portion.';
  END IF;

  RETURN public.staff_leave_count_request_days(
    target_profile,
    p_start_date,
    p_end_date,
    p_day_portion
  );
END;
$fn_preview_days$;

GRANT EXECUTE ON FUNCTION public.preview_staff_leave_request_days(uuid, date, date, text) TO authenticated;
REVOKE ALL ON FUNCTION public.preview_staff_leave_request_days(uuid, date, date, text) FROM PUBLIC, anon;
