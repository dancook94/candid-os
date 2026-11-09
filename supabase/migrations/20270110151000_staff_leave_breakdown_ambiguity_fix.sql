-- Fix ambiguous holiday_year in staff_leave_entitlement_breakdown (Test).

BEGIN;

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
#variable_conflict use_column
DECLARE
  policy public.staff_leave_policy_years;
  pattern public.staff_working_patterns;
  ent public.staff_leave_entitlements;
  usage record;
  v_holiday_year integer := p_holiday_year;
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

  SELECT * INTO policy
  FROM public.staff_leave_policy_years py
  WHERE py.holiday_year = v_holiday_year;

  IF policy.holiday_year IS NULL THEN
    RAISE EXCEPTION 'Leave policy year % is not configured.', v_holiday_year;
  END IF;

  pattern := public.staff_leave_pattern_for_profile_on_date(target_profile, as_of);

  SELECT * INTO ent
  FROM public.staff_leave_entitlements e
  WHERE e.profile_id = target_profile AND e.holiday_year = v_holiday_year;

  FOR rec IN
    SELECT bh.holiday_date AS on_date
    FROM public.staff_bank_holidays bh
    WHERE bh.holiday_year = v_holiday_year AND bh.region = 'england_wales'
  LOOP
    IF public.staff_leave_is_working_day(target_profile, rec.on_date) THEN
      bank_count := bank_count + 1;
    END IF;
  END LOOP;

  FOR rec IN
    SELECT cc.closure_date AS on_date, cc.closure_kind
    FROM public.staff_leave_company_closures cc
    WHERE cc.holiday_year = v_holiday_year
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

  ent_days := public.staff_leave_entitlement_days(target_profile, v_holiday_year, true);
  SELECT * INTO usage FROM public.staff_leave_used_days(target_profile, v_holiday_year, true);

  SELECT COALESCE(SUM(r.days_requested), 0) INTO add_paid
  FROM public.staff_leave_requests r
  WHERE r.profile_id = target_profile
    AND r.holiday_year = v_holiday_year
    AND r.leave_kind = 'additional_paid'
    AND r.status = 'approved';

  RETURN QUERY
  SELECT
    v_holiday_year,
    policy.gross_allowance_days,
    bank_count,
    compulsory_count,
    gift_count,
    public.staff_leave_reserved_pool_days(target_profile, v_holiday_year),
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

COMMIT;
