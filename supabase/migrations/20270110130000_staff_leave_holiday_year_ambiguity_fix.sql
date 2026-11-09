-- Fix ambiguous holiday_year references in leave helper functions (Test + future applies).
BEGIN;

CREATE OR REPLACE FUNCTION public.staff_leave_reserved_pool_days(
  target_profile uuid,
  p_holiday_year integer
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total numeric := 0;
  rec record;
BEGIN
  FOR rec IN
    SELECT bh.holiday_date AS on_date
    FROM public.staff_bank_holidays bh
    WHERE bh.holiday_year = p_holiday_year
      AND bh.region = 'england_wales'
  LOOP
    IF public.staff_leave_is_working_day(target_profile, rec.on_date) THEN
      total := total + 1;
    END IF;
  END LOOP;

  FOR rec IN
    SELECT cc.closure_date AS on_date
    FROM public.staff_leave_company_closures cc
    WHERE cc.holiday_year = p_holiday_year
      AND cc.closure_kind = 'compulsory_leave'
      AND NOT EXISTS (
        SELECT 1
        FROM public.staff_bank_holidays bh
        WHERE bh.holiday_date = cc.closure_date
          AND bh.region = 'england_wales'
      )
  LOOP
    IF public.staff_leave_is_working_day(target_profile, rec.on_date) THEN
      total := total + 1;
    END IF;
  END LOOP;

  RETURN ROUND(total, 2);
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_leave_entitlement_days(
  target_profile uuid,
  p_holiday_year integer,
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
BEGIN
  IF NOT skip_access_check THEN
    PERFORM public.staff_leave_assert_profile_access(target_profile);
  END IF;

  SELECT * INTO policy
  FROM public.staff_leave_policy_years py
  WHERE py.holiday_year = p_holiday_year;

  IF policy.holiday_year IS NULL THEN
    RAISE EXCEPTION 'Leave policy year % is not configured.', p_holiday_year;
  END IF;

  pattern := public.staff_leave_pattern_for_profile(target_profile);
  IF pattern.id IS NULL THEN
    pattern.fte_ratio := 1.0000;
  END IF;

  SELECT * INTO entitlement
  FROM public.staff_leave_entitlements e
  WHERE e.profile_id = target_profile
    AND e.holiday_year = p_holiday_year;

  reserved_pool := public.staff_leave_reserved_pool_days(target_profile, p_holiday_year);
  bookable := GREATEST(0, policy.gross_allowance_days - reserved_pool) * pattern.fte_ratio;

  IF entitlement.id IS NOT NULL THEN
    bookable := bookable + entitlement.adjustment_days;
    prorata := entitlement.prorata_start_date;
  END IF;

  IF prorata IS NOT NULL AND EXTRACT(YEAR FROM prorata)::integer = p_holiday_year THEN
    fraction := (
      (DATE (p_holiday_year || '-12-31')::date - prorata + 1)::numeric
      / (DATE (p_holiday_year || '-12-31')::date - DATE (p_holiday_year || '-01-01')::date + 1)::numeric
    );
    fraction := LEAST(1, GREATEST(0, fraction));
    bookable := bookable * fraction;
  END IF;

  RETURN ROUND(bookable, 2);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_leave_reserved_pool_days(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_leave_entitlement_days(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;

COMMIT;
