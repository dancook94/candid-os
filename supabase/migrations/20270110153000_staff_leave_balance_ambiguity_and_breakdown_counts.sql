-- Test only (axhkdwgmwhlbsstumndh): fix staff_leave_balance ambiguity; align breakdown closure counts.
-- Apply the ENTIRE file in one run (do not highlight partial sections).
-- Uses tagged dollar-quotes ($fn_*$) for Supabase SQL Editor compatibility.

CREATE OR REPLACE FUNCTION public.staff_leave_reserved_pool_days(
  target_profile uuid,
  holiday_year integer
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn_reserved_pool$
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
$fn_reserved_pool$;

REVOKE ALL ON FUNCTION public.staff_leave_reserved_pool_days(uuid, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_leave_entitlement_closure_counts(
  target_profile uuid,
  p_holiday_year integer,
  as_of date
)
RETURNS TABLE(
  bank_holidays_on_working_days numeric,
  compulsory_closures_on_working_days numeric,
  paid_gift_closures_on_working_days numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn_closure_counts$
DECLARE
  year_start date := make_date(p_holiday_year, 1, 1);
  year_end date := make_date(p_holiday_year, 12, 31);
  pat public.staff_working_patterns;
  seg_start date;
  seg_end date;
  next_eff date;
  bank_total numeric := 0;
  compulsory_total numeric := 0;
  gift_total numeric := 0;
  rec record;
  segment_count integer;
BEGIN
  SELECT COUNT(*)::integer INTO segment_count
  FROM public.staff_working_patterns p
  WHERE p.profile_id = target_profile
    AND p.effective_from <= year_end;

  IF segment_count = 0 THEN
    FOR rec IN
      SELECT bh.holiday_date AS on_date
      FROM public.staff_bank_holidays bh
      WHERE bh.holiday_year = p_holiday_year
        AND bh.region = 'england_wales'
    LOOP
      IF public.staff_leave_is_working_day(target_profile, rec.on_date) THEN
        bank_total := bank_total + 1;
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
          SELECT 1
          FROM public.staff_bank_holidays bh
          WHERE bh.holiday_date = rec.on_date
            AND bh.region = 'england_wales'
        ) THEN
        compulsory_total := compulsory_total + 1;
      ELSIF rec.closure_kind = 'paid_gift' THEN
        gift_total := gift_total + 1;
      END IF;
    END LOOP;
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

      FOR rec IN
        SELECT bh.holiday_date AS on_date
        FROM public.staff_bank_holidays bh
        WHERE bh.holiday_year = p_holiday_year
          AND bh.region = 'england_wales'
          AND bh.holiday_date BETWEEN seg_start AND seg_end
      LOOP
        IF public.staff_leave_is_working_day_for_pattern(pat, rec.on_date) THEN
          bank_total := bank_total + 1;
        END IF;
      END LOOP;

      FOR rec IN
        SELECT cc.closure_date AS on_date, cc.closure_kind
        FROM public.staff_leave_company_closures cc
        WHERE cc.holiday_year = p_holiday_year
          AND cc.closure_date BETWEEN seg_start AND seg_end
      LOOP
        IF NOT public.staff_leave_is_working_day_for_pattern(pat, rec.on_date) THEN
          CONTINUE;
        END IF;
        IF rec.closure_kind = 'compulsory_leave'
          AND NOT EXISTS (
            SELECT 1
            FROM public.staff_bank_holidays bh
            WHERE bh.holiday_date = rec.on_date
              AND bh.region = 'england_wales'
          ) THEN
          compulsory_total := compulsory_total + 1;
        ELSIF rec.closure_kind = 'paid_gift' THEN
          gift_total := gift_total + 1;
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  RETURN QUERY
  SELECT ROUND(bank_total, 2), ROUND(compulsory_total, 2), ROUND(gift_total, 2);
END;
$fn_closure_counts$;

REVOKE ALL ON FUNCTION public.staff_leave_entitlement_closure_counts(uuid, integer, date) FROM PUBLIC, anon, authenticated;

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
AS $fn_breakdown$
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
  closure record;
  seg record;
  ent_days numeric;
  add_paid numeric;
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
  WHERE e.profile_id = target_profile
    AND e.holiday_year = v_holiday_year;

  SELECT * INTO seg
  FROM public.staff_leave_entitlement_days_segmented(
    target_profile,
    v_holiday_year,
    as_of,
    policy.gross_allowance_days,
    false
  );

  SELECT * INTO closure
  FROM public.staff_leave_entitlement_closure_counts(target_profile, v_holiday_year, as_of);

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
    closure.bank_holidays_on_working_days,
    closure.compulsory_closures_on_working_days,
    closure.paid_gift_closures_on_working_days,
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
$fn_breakdown$;
