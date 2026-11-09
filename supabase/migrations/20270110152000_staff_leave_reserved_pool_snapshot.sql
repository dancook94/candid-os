-- Staff leave: segmented entitlement by effective-dated working patterns (Test only).
-- Replaces single-snapshot / per-future-date reserved pool with year-segment pro-rata.
-- DO NOT apply without approval.

BEGIN;

CREATE OR REPLACE FUNCTION public.staff_leave_is_working_day_for_pattern(
  p public.staff_working_patterns,
  on_date date
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dow integer;
BEGIN
  IF p.id IS NULL THEN
    dow := EXTRACT(DOW FROM on_date)::integer;
    RETURN CASE dow WHEN 0 THEN false WHEN 6 THEN false ELSE true END;
  END IF;

  dow := EXTRACT(DOW FROM on_date)::integer;
  RETURN CASE dow
    WHEN 0 THEN p.works_sun
    WHEN 1 THEN p.works_mon
    WHEN 2 THEN p.works_tue
    WHEN 3 THEN p.works_wed
    WHEN 4 THEN p.works_thu
    WHEN 5 THEN p.works_fri
    WHEN 6 THEN p.works_sat
    ELSE false
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_leave_is_working_day_for_pattern(public.staff_working_patterns, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_leave_reserved_pool_in_range_for_pattern(
  p public.staff_working_patterns,
  range_start date,
  range_end date,
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
  IF range_end < range_start THEN
    RETURN 0;
  END IF;

  FOR rec IN
    SELECT bh.holiday_date AS on_date
    FROM public.staff_bank_holidays bh
    WHERE bh.holiday_year = p_holiday_year
      AND bh.region = 'england_wales'
      AND bh.holiday_date BETWEEN range_start AND range_end
  LOOP
    IF public.staff_leave_is_working_day_for_pattern(p, rec.on_date) THEN
      total := total + 1;
    END IF;
  END LOOP;

  FOR rec IN
    SELECT cc.closure_date AS on_date
    FROM public.staff_leave_company_closures cc
    WHERE cc.holiday_year = p_holiday_year
      AND cc.closure_kind = 'compulsory_leave'
      AND cc.closure_date BETWEEN range_start AND range_end
      AND NOT EXISTS (
        SELECT 1
        FROM public.staff_bank_holidays bh
        WHERE bh.holiday_date = cc.closure_date
          AND bh.region = 'england_wales'
      )
  LOOP
    IF public.staff_leave_is_working_day_for_pattern(p, rec.on_date) THEN
      total := total + 1;
    END IF;
  END LOOP;

  RETURN ROUND(total, 2);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_leave_reserved_pool_in_range_for_pattern(public.staff_working_patterns, date, date, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_leave_reserved_pool_in_range(
  target_profile uuid,
  range_start date,
  range_end date,
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
  IF range_end < range_start THEN
    RETURN 0;
  END IF;

  FOR rec IN
    SELECT bh.holiday_date AS on_date
    FROM public.staff_bank_holidays bh
    WHERE bh.holiday_year = p_holiday_year
      AND bh.region = 'england_wales'
      AND bh.holiday_date BETWEEN range_start AND range_end
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
      AND cc.closure_date BETWEEN range_start AND range_end
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

REVOKE ALL ON FUNCTION public.staff_leave_reserved_pool_in_range(uuid, date, date, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_leave_entitlement_days_segmented(
  target_profile uuid,
  p_holiday_year integer,
  as_of date,
  gross_allowance_days numeric,
  include_adjustments boolean DEFAULT true
)
RETURNS TABLE(bookable_days numeric, reserved_pool_days numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  year_start date := make_date(p_holiday_year, 1, 1);
  year_end date := make_date(p_holiday_year, 12, 31);
  year_days integer := year_end - year_start + 1;
  pat public.staff_working_patterns;
  seg_start date;
  seg_end date;
  next_eff date;
  seg_days integer;
  gross_share numeric;
  reserved_seg numeric;
  bookable numeric := 0;
  reserved_total numeric := 0;
  entitlement public.staff_leave_entitlements;
  fraction numeric := 1;
  prorata date;
  segment_count integer;
BEGIN
  SELECT COUNT(*)::integer INTO segment_count
  FROM public.staff_working_patterns p
  WHERE p.profile_id = target_profile
    AND p.effective_from <= year_end;

  IF segment_count = 0 THEN
    reserved_seg := public.staff_leave_reserved_pool_in_range(
      target_profile,
      year_start,
      year_end,
      p_holiday_year
    );
    reserved_total := reserved_seg;
    bookable := GREATEST(0, gross_allowance_days - reserved_seg);
  ELSE
  FOR pat IN
    SELECT p.*
    FROM public.staff_working_patterns p
    WHERE p.profile_id = target_profile
      AND p.effective_from <= year_end
    ORDER BY p.effective_from
  LOOP
  IF pat.effective_from > as_of THEN
    CONTINUE;
  END IF;

    seg_start := GREATEST(pat.effective_from, year_start);

    SELECT MIN(p2.effective_from)
    INTO next_eff
    FROM public.staff_working_patterns p2
    WHERE p2.profile_id = target_profile
      AND p2.effective_from > pat.effective_from;

    IF next_eff IS NOT NULL AND next_eff <= as_of THEN
      seg_end := LEAST(next_eff - 1, year_end);
    ELSE
      seg_end := year_end;
    END IF;

    IF seg_end < seg_start THEN
      CONTINUE;
    END IF;

    seg_days := seg_end - seg_start + 1;
    gross_share := gross_allowance_days * (seg_days::numeric / year_days::numeric);
    reserved_seg := public.staff_leave_reserved_pool_in_range_for_pattern(
      pat,
      seg_start,
      seg_end,
      p_holiday_year
    );
    reserved_total := reserved_total + reserved_seg;
    bookable := bookable + GREATEST(0, gross_share - reserved_seg) * pat.fte_ratio;
  END LOOP;
  END IF;

  IF include_adjustments THEN
    SELECT * INTO entitlement
    FROM public.staff_leave_entitlements e
    WHERE e.profile_id = target_profile
      AND e.holiday_year = p_holiday_year;

    IF entitlement.id IS NOT NULL THEN
      bookable := bookable + entitlement.adjustment_days;
      prorata := entitlement.prorata_start_date;
      IF prorata IS NOT NULL AND EXTRACT(YEAR FROM prorata)::integer = p_holiday_year THEN
        fraction := (
          (year_end - prorata + 1)::numeric
          / year_days::numeric
        );
        fraction := LEAST(1, GREATEST(0, fraction));
        bookable := bookable * fraction;
      END IF;
    END IF;
  END IF;

  RETURN QUERY
  SELECT ROUND(bookable, 2), ROUND(reserved_total, 2);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_leave_entitlement_days_segmented(uuid, integer, date, numeric, boolean) FROM PUBLIC, anon, authenticated;

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
  v_holiday_year integer := holiday_year;
  as_of date;
  seg record;
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

  SELECT * INTO seg
  FROM public.staff_leave_entitlement_days_segmented(
    target_profile,
    v_holiday_year,
    as_of,
    policy.gross_allowance_days,
    true
  );

  RETURN seg.bookable_days;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_leave_reserved_pool_days(
  target_profile uuid,
  holiday_year integer
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_holiday_year integer := holiday_year;
  as_of date;
  seg record;
  policy public.staff_leave_policy_years;
BEGIN
  as_of := LEAST(
    (now() AT TIME ZONE 'Europe/London')::date,
    make_date(v_holiday_year, 12, 31)
  );

  SELECT * INTO policy
  FROM public.staff_leave_policy_years py
  WHERE py.holiday_year = v_holiday_year;
  IF policy.holiday_year IS NULL THEN
    RETURN 0;
  END IF;

  SELECT * INTO seg
  FROM public.staff_leave_entitlement_days_segmented(
    target_profile,
    v_holiday_year,
    as_of,
    policy.gross_allowance_days,
    false
  );

  RETURN seg.reserved_pool_days;
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
  seg record;
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

  SELECT * INTO seg
  FROM public.staff_leave_entitlement_days_segmented(
    target_profile,
    v_holiday_year,
    as_of,
    policy.gross_allowance_days,
    false
  );

  FOR rec IN
    SELECT bh.holiday_date AS on_date
    FROM public.staff_bank_holidays bh
    WHERE bh.holiday_year = v_holiday_year AND bh.region = 'england_wales'
  LOOP
    IF public.staff_leave_is_working_day(target_profile, rec.on_date)
      AND rec.on_date <= as_of THEN
      bank_count := bank_count + 1;
    END IF;
  END LOOP;

  FOR rec IN
    SELECT cc.closure_date AS on_date, cc.closure_kind
    FROM public.staff_leave_company_closures cc
    WHERE cc.holiday_year = v_holiday_year
  LOOP
    IF rec.on_date > as_of THEN
      CONTINUE;
    END IF;
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
    seg.reserved_pool_days,
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

COMMENT ON FUNCTION public.staff_leave_entitlement_days_segmented(uuid, integer, date, numeric, boolean) IS
  'Splits the holiday year by effective-dated working patterns. Skips segments with effective_from > as_of. Until a future pattern is effective, the active segment runs to year-end. Each segment: (gross pro-rata − reserved in range for that pattern) × FTE.';

COMMIT;
