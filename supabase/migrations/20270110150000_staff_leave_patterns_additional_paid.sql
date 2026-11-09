-- Staff working patterns (effective-dated), entitlement audit, and additional paid leave (Test).

BEGIN;

-- ---------------------------------------------------------------------------
-- Working pattern effective dating (does not rewrite historical request days)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_leave_pattern_for_profile_on_date(
  target_profile uuid,
  on_date date
)
RETURNS public.staff_working_patterns
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.*
  FROM public.staff_working_patterns p
  WHERE p.profile_id = target_profile
    AND p.effective_from <= on_date
  ORDER BY p.effective_from DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.staff_leave_pattern_for_profile_on_date(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_leave_pattern_for_profile(target_profile uuid)
RETURNS public.staff_working_patterns
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.staff_leave_pattern_for_profile_on_date(
    target_profile,
    (now() AT TIME ZONE 'Europe/London')::date
  );
$$;

CREATE OR REPLACE FUNCTION public.staff_leave_is_working_day(
  target_profile uuid,
  on_date date
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pattern public.staff_working_patterns;
  dow integer;
BEGIN
  dow := EXTRACT(DOW FROM on_date)::integer;
  pattern := public.staff_leave_pattern_for_profile_on_date(target_profile, on_date);

  IF pattern.id IS NULL THEN
    RETURN CASE dow
      WHEN 0 THEN false
      WHEN 6 THEN false
      ELSE true
    END;
  END IF;

  RETURN CASE dow
    WHEN 0 THEN pattern.works_sun
    WHEN 1 THEN pattern.works_mon
    WHEN 2 THEN pattern.works_tue
    WHEN 3 THEN pattern.works_wed
    WHEN 4 THEN pattern.works_thu
    WHEN 5 THEN pattern.works_fri
    WHEN 6 THEN pattern.works_sat
    ELSE false
  END;
END;
$$;

-- ---------------------------------------------------------------------------
-- Audit tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staff_working_pattern_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pattern_id       uuid REFERENCES public.staff_working_patterns(id) ON DELETE SET NULL,
  actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  change_note      text,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staff_leave_entitlement_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  holiday_year     integer NOT NULL,
  actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  change_note      text,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_leave_entitlements
  ADD COLUMN IF NOT EXISTS adjustment_reason text;

ALTER TABLE public.staff_leave_requests
  ADD COLUMN IF NOT EXISTS leave_kind text NOT NULL DEFAULT 'annual',
  ADD COLUMN IF NOT EXISTS grant_reason text;

ALTER TABLE public.staff_leave_requests
  DROP CONSTRAINT IF EXISTS staff_leave_requests_leave_kind_check;

ALTER TABLE public.staff_leave_requests
  ADD CONSTRAINT staff_leave_requests_leave_kind_check
  CHECK (leave_kind IN ('annual', 'additional_paid'));

COMMENT ON COLUMN public.staff_leave_requests.leave_kind IS
  'annual deducts from bookable allowance; additional_paid is paid time off that does not reduce annual balance.';

-- ---------------------------------------------------------------------------
-- Cross-kind absence overlap (annual + additional paid)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_leave_has_blocking_overlap(
  p_profile_id uuid,
  p_start_date date,
  p_end_date date,
  p_exclude_request_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_leave_requests r
    WHERE r.profile_id = p_profile_id
      AND r.status IN ('pending', 'approved')
      AND (p_exclude_request_id IS NULL OR r.id IS DISTINCT FROM p_exclude_request_id)
      AND p_start_date <= r.end_date
      AND r.start_date <= p_end_date
  );
$$;

REVOKE ALL ON FUNCTION public.staff_leave_has_blocking_overlap(uuid, date, date, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Per-profile transaction lock + approval headroom (annual balance on approve)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_leave_lock_profile(p_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_profile_id::text));
END;
$$;

REVOKE ALL ON FUNCTION public.staff_leave_lock_profile(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_leave_annual_approval_headroom(
  target_profile uuid,
  p_holiday_year integer,
  p_exclude_request_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ROUND(
    public.staff_leave_entitlement_days(target_profile, p_holiday_year, true)
    - COALESCE((
        SELECT SUM(r.days_requested)
        FROM public.staff_leave_requests r
        WHERE r.profile_id = target_profile
          AND r.holiday_year = p_holiday_year
          AND r.leave_kind = 'annual'
          AND r.status = 'approved'
      ), 0)
    - COALESCE((
        SELECT SUM(r.days_requested)
        FROM public.staff_leave_requests r
        WHERE r.profile_id = target_profile
          AND r.holiday_year = p_holiday_year
          AND r.leave_kind = 'annual'
          AND r.status = 'pending'
          AND (p_exclude_request_id IS NULL OR r.id IS DISTINCT FROM p_exclude_request_id)
      ), 0),
    2
  );
$$;

REVOKE ALL ON FUNCTION public.staff_leave_annual_approval_headroom(uuid, integer, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Database-level active leave date overlap (pending + approved)
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.staff_leave_requests
  DROP CONSTRAINT IF EXISTS staff_leave_requests_active_dates_no_overlap;

ALTER TABLE public.staff_leave_requests
  ADD CONSTRAINT staff_leave_requests_active_dates_no_overlap
  EXCLUDE USING gist (
    profile_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  )
  WHERE (status IN ('pending', 'approved'));

COMMENT ON CONSTRAINT staff_leave_requests_active_dates_no_overlap ON public.staff_leave_requests IS
  'Prevents overlapping pending or approved leave for the same employee regardless of leave kind.';

-- ---------------------------------------------------------------------------
-- Annual usage excludes additional paid leave
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_leave_used_days(
  target_profile uuid,
  p_holiday_year integer,
  include_pending boolean DEFAULT true
)
RETURNS TABLE(approved_days numeric, pending_days numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(r.days_requested) FILTER (WHERE r.status = 'approved'), 0)::numeric,
    CASE
      WHEN include_pending THEN COALESCE(SUM(r.days_requested) FILTER (WHERE r.status = 'pending'), 0)::numeric
      ELSE 0::numeric
    END
  FROM public.staff_leave_requests r
  WHERE r.profile_id = target_profile
    AND r.holiday_year = p_holiday_year
    AND r.leave_kind = 'annual';
$$;

CREATE OR REPLACE FUNCTION public.staff_leave_entitlement_days(
  target_profile uuid,
  holiday_year integer,
  skip_access_check boolean DEFAULT false
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  policy public.staff_leave_policy_years;
  pattern public.staff_working_patterns;
  entitlement public.staff_leave_entitlements;
  reserved_pool numeric;
  bookable numeric;
  fraction numeric := 1;
  prorata date;
  v_holiday_year integer := holiday_year;
  as_of date;
BEGIN
  IF NOT skip_access_check THEN
    PERFORM public.staff_leave_assert_profile_access(target_profile);
  END IF;

  as_of := LEAST(
    (now() AT TIME ZONE 'Europe/London')::date,
    make_date(v_holiday_year, 12, 31)
  );

  SELECT * INTO policy
  FROM public.staff_leave_policy_years py
  WHERE py.holiday_year = v_holiday_year;

  IF policy.holiday_year IS NULL THEN
    RAISE EXCEPTION 'Leave policy year % is not configured.', v_holiday_year;
  END IF;

  pattern := public.staff_leave_pattern_for_profile_on_date(target_profile, as_of);
  IF pattern.id IS NULL THEN
    pattern.fte_ratio := 1.0000;
  END IF;

  SELECT * INTO entitlement
  FROM public.staff_leave_entitlements e
  WHERE e.profile_id = target_profile
    AND e.holiday_year = v_holiday_year;

  reserved_pool := public.staff_leave_reserved_pool_days(target_profile, v_holiday_year);
  bookable := GREATEST(0, policy.gross_allowance_days - reserved_pool) * pattern.fte_ratio;

  IF entitlement.id IS NOT NULL THEN
    bookable := bookable + entitlement.adjustment_days;
    prorata := entitlement.prorata_start_date;
  END IF;

  IF prorata IS NOT NULL AND EXTRACT(YEAR FROM prorata)::integer = v_holiday_year THEN
    fraction := (
      (DATE (v_holiday_year || '-12-31')::date - prorata + 1)::numeric
      / (DATE (v_holiday_year || '-12-31')::date - DATE (v_holiday_year || '-01-01')::date + 1)::numeric
    );
    fraction := LEAST(1, GREATEST(0, fraction));
    bookable := bookable * fraction;
  END IF;

  RETURN ROUND(bookable, 2);
END;
$$;

-- ---------------------------------------------------------------------------
-- Admin RPCs: working pattern & entitlement (append-only pattern history)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_staff_working_pattern(
  p_profile_id uuid,
  p_effective_from date,
  p_works_mon boolean,
  p_works_tue boolean,
  p_works_wed boolean,
  p_works_thu boolean,
  p_works_fri boolean,
  p_works_sat boolean,
  p_works_sun boolean,
  p_fte_ratio numeric,
  p_change_note text DEFAULT NULL
)
RETURNS public.staff_working_patterns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  row public.staff_working_patterns;
  note text := NULLIF(btrim(p_change_note), '');
BEGIN
  IF actor IS NULL OR NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Only approved admins can set working patterns.';
  END IF;

  IF p_fte_ratio <= 0 OR p_fte_ratio > 1 THEN
    RAISE EXCEPTION 'FTE ratio must be between 0 and 1.';
  END IF;

  IF NOT (
    p_works_mon OR p_works_tue OR p_works_wed OR p_works_thu
    OR p_works_fri OR p_works_sat OR p_works_sun
  ) THEN
    RAISE EXCEPTION 'Select at least one normal working day.';
  END IF;

  IF note IS NULL THEN
    RAISE EXCEPTION 'A change note is required for working pattern updates.';
  END IF;

  INSERT INTO public.staff_working_patterns (
    profile_id,
    effective_from,
    works_mon,
    works_tue,
    works_wed,
    works_thu,
    works_fri,
    works_sat,
    works_sun,
    fte_ratio
  )
  VALUES (
    p_profile_id,
    p_effective_from,
    p_works_mon,
    p_works_tue,
    p_works_wed,
    p_works_thu,
    p_works_fri,
    p_works_sat,
    p_works_sun,
    p_fte_ratio
  )
  RETURNING * INTO row;

  INSERT INTO public.staff_working_pattern_events (
    profile_id,
    pattern_id,
    actor_profile_id,
    change_note,
    payload
  )
  VALUES (
    p_profile_id,
    row.id,
    actor,
    note,
    jsonb_build_object(
      'effective_from', row.effective_from,
      'fte_ratio', row.fte_ratio,
      'works', jsonb_build_object(
        'mon', row.works_mon,
        'tue', row.works_tue,
        'wed', row.works_wed,
        'thu', row.works_thu,
        'fri', row.works_fri,
        'sat', row.works_sat,
        'sun', row.works_sun
      ),
      'notify_email', false,
      'sync_google_calendar', false
    )
  );

  RETURN row;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_staff_leave_entitlement(
  p_profile_id uuid,
  p_holiday_year integer,
  p_adjustment_days numeric,
  p_prorata_start_date date DEFAULT NULL,
  p_adjustment_reason text DEFAULT NULL
)
RETURNS public.staff_leave_entitlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  ent public.staff_leave_entitlements;
  reason text := NULLIF(btrim(p_adjustment_reason), '');
BEGIN
  IF actor IS NULL OR NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Only approved admins can set leave entitlements.';
  END IF;

  IF p_holiday_year < 2027 THEN
    RAISE EXCEPTION 'Leave entitlements are available from 2027.';
  END IF;

  IF p_adjustment_days < -50 OR p_adjustment_days > 50 THEN
    RAISE EXCEPTION 'Adjustment is out of allowed bounds.';
  END IF;

  IF p_adjustment_days <> 0 AND reason IS NULL THEN
    RAISE EXCEPTION 'An adjustment reason is required when changing allowance.';
  END IF;

  INSERT INTO public.staff_leave_entitlements (
    profile_id,
    holiday_year,
    adjustment_days,
    prorata_start_date,
    adjustment_reason
  )
  VALUES (
    p_profile_id,
    p_holiday_year,
    p_adjustment_days,
    p_prorata_start_date,
    reason
  )
  ON CONFLICT (profile_id, holiday_year)
  DO UPDATE SET
    adjustment_days = EXCLUDED.adjustment_days,
    prorata_start_date = EXCLUDED.prorata_start_date,
    adjustment_reason = EXCLUDED.adjustment_reason,
    updated_at = now()
  RETURNING * INTO ent;

  INSERT INTO public.staff_leave_entitlement_events (
    profile_id,
    holiday_year,
    actor_profile_id,
    change_note,
    payload
  )
  VALUES (
    p_profile_id,
    p_holiday_year,
    actor,
    reason,
    jsonb_build_object(
      'adjustment_days', ent.adjustment_days,
      'prorata_start_date', ent.prorata_start_date,
      'notify_email', false,
      'sync_google_calendar', false
    )
  );

  RETURN ent;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_leave_entitlement_breakdown(
  target_profile uuid,
  p_holiday_year integer
)
RETURNS TABLE(
  holiday_year integer,
  gross_allowance_days numeric,
  bank_holidays_on_working_days numeric,
  compulsory_closures_on_working_days numeric,
  paid_gift_closures_on_working_days numeric,
  reserved_pool_days numeric,
  fte_ratio numeric,
  adjustment_days numeric,
  prorata_start_date date,
  bookable_entitlement_days numeric,
  approved_annual_days numeric,
  pending_annual_days numeric,
  remaining_annual_days numeric,
  pattern_effective_from date,
  additional_paid_approved_days numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  policy public.staff_leave_policy_years;
  pattern public.staff_working_patterns;
  ent public.staff_leave_entitlements;
  usage record;
  as_of date := LEAST(
    (now() AT TIME ZONE 'Europe/London')::date,
    make_date(p_holiday_year, 12, 31)
  );
  bank_count numeric := 0;
  compulsory_count numeric := 0;
  gift_count numeric := 0;
  ent_days numeric;
  add_paid numeric;
  rec record;
BEGIN
  PERFORM public.staff_leave_assert_profile_access(target_profile);

  SELECT * INTO policy FROM public.staff_leave_policy_years WHERE holiday_year = p_holiday_year;
  IF policy.holiday_year IS NULL THEN
    RAISE EXCEPTION 'Leave policy year % is not configured.', p_holiday_year;
  END IF;

  pattern := public.staff_leave_pattern_for_profile_on_date(target_profile, as_of);

  SELECT * INTO ent
  FROM public.staff_leave_entitlements e
  WHERE e.profile_id = target_profile AND e.holiday_year = p_holiday_year;

  FOR rec IN
    SELECT bh.holiday_date AS on_date
    FROM public.staff_bank_holidays bh
    WHERE bh.holiday_year = p_holiday_year AND bh.region = 'england_wales'
  LOOP
    IF public.staff_leave_is_working_day(target_profile, rec.on_date) THEN
      bank_count := bank_count + 1;
    END IF;
  END LOOP;

  FOR rec IN
    SELECT cc.closure_date AS on_date, cc.closure_kind
    FROM public.staff_leave_company_closures cc
    WHERE cc.holiday_year = p_holiday_year
  LOOP
  IF NOT public.staff_leave_is_working_day(target_profile, rec.on_date) THEN
    CONTINUE;
  END IF;
    IF rec.closure_kind = 'compulsory_leave'
      AND NOT EXISTS (
        SELECT 1 FROM public.staff_bank_holidays bh
        WHERE bh.holiday_date = rec.on_date AND bh.region = 'england_wales'
      ) THEN
      compulsory_count := compulsory_count + 1;
    ELSIF rec.closure_kind = 'paid_gift' THEN
      gift_count := gift_count + 1;
    END IF;
  END LOOP;

  ent_days := public.staff_leave_entitlement_days(target_profile, p_holiday_year, true);
  SELECT * INTO usage FROM public.staff_leave_used_days(target_profile, p_holiday_year, true);

  SELECT COALESCE(SUM(r.days_requested), 0) INTO add_paid
  FROM public.staff_leave_requests r
  WHERE r.profile_id = target_profile
    AND r.holiday_year = p_holiday_year
    AND r.leave_kind = 'additional_paid'
    AND r.status = 'approved';

  RETURN QUERY
  SELECT
    p_holiday_year,
    policy.gross_allowance_days,
    bank_count,
    compulsory_count,
    gift_count,
    public.staff_leave_reserved_pool_days(target_profile, p_holiday_year),
    COALESCE(pattern.fte_ratio, 1.0000::numeric),
    COALESCE(ent.adjustment_days, 0::numeric),
    ent.prorata_start_date,
    ent_days,
    ROUND(COALESCE(usage.approved_days, 0), 2),
    ROUND(COALESCE(usage.pending_days, 0), 2),
    ROUND(ent_days - COALESCE(usage.approved_days, 0) - COALESCE(usage.pending_days, 0), 2),
    pattern.effective_from,
    ROUND(add_paid, 2);
END;
$$;

-- ---------------------------------------------------------------------------
-- Additional paid leave RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_staff_additional_paid_leave_request(
  p_start_date date,
  p_end_date date,
  p_day_portion text,
  p_employee_note text DEFAULT NULL
)
RETURNS public.staff_leave_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  new_request public.staff_leave_requests;
  days numeric;
  hy integer := EXTRACT(YEAR FROM p_start_date)::integer;
BEGIN
  IF actor IS NULL OR NOT public.is_approved_staff() THEN
    RAISE EXCEPTION 'Only approved staff can submit additional paid leave.';
  END IF;

  PERFORM public.staff_leave_lock_profile(actor);

  IF hy < 2027 THEN
    RAISE EXCEPTION 'Leave requests are available from 2027.';
  END IF;

  IF p_day_portion NOT IN ('full', 'am', 'pm') THEN
    RAISE EXCEPTION 'Invalid day portion.';
  END IF;

  days := public.staff_leave_count_request_days(actor, p_start_date, p_end_date, p_day_portion);
  IF days <= 0 THEN
    RAISE EXCEPTION 'The selected dates do not include any working days.';
  END IF;

  IF public.staff_leave_has_blocking_overlap(actor, p_start_date, p_end_date, NULL) THEN
    RAISE EXCEPTION 'These dates overlap existing annual or additional paid leave.';
  END IF;

  INSERT INTO public.staff_leave_requests (
    profile_id, holiday_year, leave_kind, status,
    start_date, end_date, day_portion, days_requested, employee_note
  )
  VALUES (
    actor, hy, 'additional_paid', 'pending',
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
      'leave_kind', 'additional_paid',
      'days_requested', days,
      'notify_email', false,
      'sync_google_calendar', false
    )
  );

  RETURN new_request;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'These dates overlap existing annual or additional paid leave.';
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_staff_additional_paid_leave(
  p_profile_id uuid,
  p_start_date date,
  p_end_date date,
  p_day_portion text,
  p_grant_reason text,
  p_decision_note text DEFAULT NULL
)
RETURNS public.staff_leave_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  new_request public.staff_leave_requests;
  days numeric;
  hy integer := EXTRACT(YEAR FROM p_start_date)::integer;
  reason text := NULLIF(btrim(p_grant_reason), '');
BEGIN
  IF actor IS NULL OR NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Only approved admins can grant additional paid leave.';
  END IF;

  PERFORM public.staff_leave_lock_profile(p_profile_id);

  IF reason IS NULL THEN
    RAISE EXCEPTION 'A grant reason is required.';
  END IF;

  IF p_day_portion NOT IN ('full', 'am', 'pm') THEN
    RAISE EXCEPTION 'Invalid day portion.';
  END IF;

  days := public.staff_leave_count_request_days(p_profile_id, p_start_date, p_end_date, p_day_portion);
  IF days <= 0 THEN
    RAISE EXCEPTION 'The selected dates do not include any working days.';
  END IF;

  IF public.staff_leave_has_blocking_overlap(p_profile_id, p_start_date, p_end_date, NULL) THEN
    RAISE EXCEPTION 'These dates overlap existing annual or additional paid leave.';
  END IF;

  INSERT INTO public.staff_leave_requests (
    profile_id, holiday_year, leave_kind, status,
    start_date, end_date, day_portion, days_requested,
    employee_note, grant_reason, decision_note,
    decided_by, decided_at
  )
  VALUES (
    p_profile_id, hy, 'additional_paid', 'approved',
    p_start_date, p_end_date, p_day_portion, days,
    NULL, reason, NULLIF(btrim(p_decision_note), ''),
    actor, now()
  )
  RETURNING * INTO new_request;

  INSERT INTO public.staff_leave_request_events (request_id, event_type, actor_profile_id, payload)
  VALUES
    (new_request.id, 'submitted', actor, jsonb_build_object('leave_kind', 'additional_paid', 'granted_by_admin', true)),
    (new_request.id, 'approved', actor, jsonb_build_object('grant_reason', reason, 'notify_email', false, 'sync_google_calendar', false));

  RETURN new_request;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'These dates overlap existing annual or additional paid leave.';
END;
$$;

-- Ensure annual submits stay annual
CREATE OR REPLACE FUNCTION public.submit_staff_leave_request(
  p_start_date date,
  p_end_date date,
  p_day_portion text,
  p_employee_note text DEFAULT NULL
)
RETURNS public.staff_leave_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  new_request public.staff_leave_requests;
  days numeric;
  bal record;
  hy integer := EXTRACT(YEAR FROM p_start_date)::integer;
BEGIN
  IF actor IS NULL OR NOT public.is_approved_staff() THEN
    RAISE EXCEPTION 'Only approved staff can submit leave requests.';
  END IF;

  PERFORM public.staff_leave_lock_profile(actor);

  IF hy < 2027 THEN
    RAISE EXCEPTION 'Leave requests are available from 2027.';
  END IF;

  IF EXTRACT(YEAR FROM p_end_date)::integer <> hy THEN
    RAISE EXCEPTION 'A single request cannot cross holiday years.';
  END IF;

  IF p_day_portion NOT IN ('full', 'am', 'pm') THEN
    RAISE EXCEPTION 'Invalid day portion.';
  END IF;

  days := public.staff_leave_count_request_days(actor, p_start_date, p_end_date, p_day_portion);
  IF days <= 0 THEN
    RAISE EXCEPTION 'The selected dates do not include any bookable working days.';
  END IF;

  IF public.staff_leave_has_blocking_overlap(actor, p_start_date, p_end_date, NULL) THEN
    RAISE EXCEPTION 'These dates overlap existing annual or additional paid leave.';
  END IF;

  SELECT * INTO bal FROM public.staff_leave_balance(actor, hy);

  IF bal.remaining_days - days < 0 THEN
    RAISE EXCEPTION 'Insufficient remaining leave balance.';
  END IF;

  INSERT INTO public.staff_leave_requests (
    profile_id, holiday_year, leave_kind, status,
    start_date, end_date, day_portion, days_requested, employee_note
  )
  VALUES (
    actor, hy, 'annual', 'pending',
    p_start_date, p_end_date, p_day_portion, days,
    NULLIF(btrim(p_employee_note), '')
  )
  RETURNING * INTO new_request;

  INSERT INTO public.staff_leave_request_events (request_id, event_type, actor_profile_id, payload)
  VALUES (
    new_request.id,
    'submitted',
    actor,
    jsonb_build_object('leave_kind', 'annual', 'days_requested', days, 'day_portion', p_day_portion)
  );

  RETURN new_request;
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'These dates overlap existing annual or additional paid leave.';
END;
$$;

-- ---------------------------------------------------------------------------
-- RLS / grants
-- ---------------------------------------------------------------------------

ALTER TABLE public.staff_working_pattern_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_leave_entitlement_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_working_pattern_events_admin_select
  ON public.staff_working_pattern_events
  FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

CREATE POLICY staff_leave_entitlement_events_admin_select
  ON public.staff_leave_entitlement_events
  FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

REVOKE INSERT, UPDATE, DELETE ON TABLE public.staff_working_pattern_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.staff_leave_entitlement_events FROM authenticated;
GRANT SELECT ON TABLE public.staff_working_pattern_events TO authenticated;
GRANT SELECT ON TABLE public.staff_leave_entitlement_events TO authenticated;

GRANT EXECUTE ON FUNCTION public.set_staff_working_pattern(uuid, date, boolean, boolean, boolean, boolean, boolean, boolean, boolean, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_staff_leave_entitlement(uuid, integer, numeric, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_leave_entitlement_breakdown(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_staff_additional_paid_leave_request(date, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_staff_additional_paid_leave(uuid, date, date, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.set_staff_working_pattern(uuid, date, boolean, boolean, boolean, boolean, boolean, boolean, boolean, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_staff_leave_entitlement(uuid, integer, numeric, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_leave_entitlement_breakdown(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_staff_additional_paid_leave_request(date, date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.grant_staff_additional_paid_leave(uuid, date, date, text, text, text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.decide_staff_leave_request(
  p_request_id uuid,
  p_decision text,
  p_decision_note text DEFAULT NULL
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
  request_kind text;
  req_start date;
  req_end date;
  req_status text;
  req_days numeric;
  req_holiday_year integer;
  approval_headroom numeric;
BEGIN
  IF actor IS NULL OR NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Only approved admins can approve or decline leave.';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected.';
  END IF;

  SELECT
    r.profile_id,
    r.leave_kind,
    r.start_date,
    r.end_date,
    r.status,
    r.days_requested,
    r.holiday_year
  INTO
    owner_id,
    request_kind,
    req_start,
    req_end,
    req_status,
    req_days,
    req_holiday_year
  FROM public.staff_leave_requests r
  WHERE r.id = p_request_id
  FOR UPDATE;

  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Leave request was not found.';
  END IF;

  IF owner_id = actor THEN
    RAISE EXCEPTION 'Approvers cannot decide their own leave request.';
  END IF;

  PERFORM public.staff_leave_lock_profile(owner_id);

  IF p_decision = 'approved' AND req_status = 'pending' THEN
    IF public.staff_leave_has_blocking_overlap(owner_id, req_start, req_end, p_request_id) THEN
      RAISE EXCEPTION 'These dates overlap existing annual or additional paid leave.';
    END IF;

    IF request_kind = 'annual' THEN
      approval_headroom := public.staff_leave_annual_approval_headroom(
        owner_id,
        req_holiday_year,
        p_request_id
      );
      IF approval_headroom < req_days THEN
        RAISE EXCEPTION 'Insufficient remaining leave balance to approve this request.';
      END IF;
    END IF;
  END IF;

  UPDATE public.staff_leave_requests r
  SET
    status = p_decision,
    decision_note = NULLIF(btrim(p_decision_note), ''),
    grant_reason = CASE
      WHEN request_kind = 'additional_paid' AND p_decision = 'approved'
        THEN COALESCE(NULLIF(btrim(p_decision_note), ''), r.grant_reason)
      ELSE r.grant_reason
    END,
    decided_by = actor,
    decided_at = now(),
    updated_at = now()
  WHERE r.id = p_request_id
    AND r.status = 'pending'
  RETURNING * INTO updated_request;

  IF updated_request.id IS NULL THEN
    RAISE EXCEPTION 'Leave request is not awaiting approval or was already decided.';
  END IF;

  INSERT INTO public.staff_leave_request_events (request_id, event_type, actor_profile_id, payload)
  VALUES (
    updated_request.id,
    p_decision,
    actor,
    jsonb_build_object(
      'decision_note', NULLIF(btrim(p_decision_note), ''),
      'leave_kind', updated_request.leave_kind,
      'notify_email', false,
      'sync_google_calendar', false
    )
  );

  RETURN updated_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_working_patterns_reject_direct_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT public.staff_leave_block_direct_client_write() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Use set_staff_working_pattern to record working pattern changes.';
END;
$$;

DROP TRIGGER IF EXISTS staff_working_patterns_reject_direct_write_trigger
  ON public.staff_working_patterns;

CREATE TRIGGER staff_working_patterns_reject_direct_write_trigger
  BEFORE INSERT OR UPDATE ON public.staff_working_patterns
  FOR EACH ROW
  EXECUTE FUNCTION public.staff_working_patterns_reject_direct_write();

CREATE OR REPLACE FUNCTION public.staff_leave_entitlements_reject_direct_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT public.staff_leave_block_direct_client_write() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Use set_staff_leave_entitlement to record entitlement changes.';
END;
$$;

DROP TRIGGER IF EXISTS staff_leave_entitlements_reject_direct_write_trigger
  ON public.staff_leave_entitlements;

CREATE TRIGGER staff_leave_entitlements_reject_direct_write_trigger
  BEFORE INSERT OR UPDATE ON public.staff_leave_entitlements
  FOR EACH ROW
  EXECUTE FUNCTION public.staff_leave_entitlements_reject_direct_write();

-- Serialize cancel with submit/approve/grant for reliable rebooking after cancellation.
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

  PERFORM public.staff_leave_lock_profile(owner_id);

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

COMMIT;
