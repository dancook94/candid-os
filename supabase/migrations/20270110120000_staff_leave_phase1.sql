-- Staff Holiday & Absence Management — Phase 1 (Test).
-- Apply manually on candid-os-test Supabase only. DO NOT run automatically.

BEGIN;

-- ---------------------------------------------------------------------------
-- Direct-session guard (SECURITY DEFINER RPCs run as owner, not as caller)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_leave_block_direct_client_write()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT session_user IN ('authenticated', 'anon')
    AND current_user IN ('authenticated', 'anon');
$$;

REVOKE ALL ON FUNCTION public.staff_leave_block_direct_client_write() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.staff_leave_assert_profile_access(target_profile uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR NOT public.is_approved_staff() THEN
    RAISE EXCEPTION 'Unauthorized.';
  END IF;

  IF target_profile IS DISTINCT FROM actor
    AND NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Forbidden.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_leave_assert_profile_access(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Policy & reference data
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staff_leave_policy_years (
  holiday_year            integer PRIMARY KEY,
  gross_allowance_days    numeric(6,2) NOT NULL,
  reserved_closure_slots  integer NOT NULL DEFAULT 3,
  region                  text NOT NULL DEFAULT 'england_wales',
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT staff_leave_policy_years_region_check
    CHECK (region IN ('england_wales')),
  CONSTRAINT staff_leave_policy_years_gross_positive
    CHECK (gross_allowance_days > 0),
  CONSTRAINT staff_leave_policy_years_closure_slots_check
    CHECK (reserved_closure_slots >= 0 AND reserved_closure_slots <= 10)
);

CREATE TABLE IF NOT EXISTS public.staff_bank_holidays (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_year integer NOT NULL,
  holiday_date date NOT NULL,
  name        text NOT NULL,
  region      text NOT NULL DEFAULT 'england_wales',
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT staff_bank_holidays_region_check
    CHECK (region IN ('england_wales')),
  CONSTRAINT staff_bank_holidays_unique_date_region
    UNIQUE (holiday_date, region)
);

CREATE TABLE IF NOT EXISTS public.staff_leave_company_closures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_year  integer NOT NULL,
  closure_date  date NOT NULL,
  name          text NOT NULL DEFAULT 'Company closure',
  closure_kind  text NOT NULL DEFAULT 'compulsory_leave',
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT staff_leave_company_closures_unique_date
    UNIQUE (closure_date),
  CONSTRAINT staff_leave_company_closures_kind_check
    CHECK (closure_kind IN ('compulsory_leave', 'paid_gift'))
);

COMMENT ON COLUMN public.staff_leave_company_closures.closure_kind IS
  'compulsory_leave deducts from the 28-day entitlement pool; paid_gift is paid but does not reduce bookable allowance.';

CREATE TABLE IF NOT EXISTS public.staff_working_patterns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  effective_from  date NOT NULL DEFAULT DATE '2027-01-01',
  works_mon       boolean NOT NULL DEFAULT true,
  works_tue       boolean NOT NULL DEFAULT true,
  works_wed       boolean NOT NULL DEFAULT true,
  works_thu       boolean NOT NULL DEFAULT true,
  works_fri       boolean NOT NULL DEFAULT true,
  works_sat       boolean NOT NULL DEFAULT false,
  works_sun       boolean NOT NULL DEFAULT false,
  fte_ratio       numeric(5,4) NOT NULL DEFAULT 1.0000,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT staff_working_patterns_fte_check
    CHECK (fte_ratio > 0 AND fte_ratio <= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_working_patterns_profile_effective_idx
  ON public.staff_working_patterns (profile_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS public.staff_leave_entitlements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  holiday_year      integer NOT NULL,
  adjustment_days   numeric(6,2) NOT NULL DEFAULT 0,
  prorata_start_date date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT staff_leave_entitlements_unique_profile_year
    UNIQUE (profile_id, holiday_year),
  CONSTRAINT staff_leave_entitlements_adjustment_bounds
    CHECK (adjustment_days >= -50 AND adjustment_days <= 50)
);

-- ---------------------------------------------------------------------------
-- Requests, sickness, audit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staff_leave_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  holiday_year     integer NOT NULL,
  status           text NOT NULL DEFAULT 'pending',
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  day_portion      text NOT NULL DEFAULT 'full',
  days_requested   numeric(6,2) NOT NULL,
  employee_note    text,
  decision_note    text,
  decided_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT staff_leave_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  CONSTRAINT staff_leave_requests_day_portion_check
    CHECK (day_portion IN ('full', 'am', 'pm')),
  CONSTRAINT staff_leave_requests_date_order_check
    CHECK (end_date >= start_date),
  CONSTRAINT staff_leave_requests_days_positive
    CHECK (days_requested > 0),
  CONSTRAINT staff_leave_requests_half_day_same_date
    CHECK (day_portion = 'full' OR start_date = end_date)
);

CREATE INDEX IF NOT EXISTS staff_leave_requests_profile_year_idx
  ON public.staff_leave_requests (profile_id, holiday_year);

CREATE INDEX IF NOT EXISTS staff_leave_requests_status_idx
  ON public.staff_leave_requests (status)
  WHERE status IN ('pending', 'approved');

CREATE TABLE IF NOT EXISTS public.staff_absence_sickness (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  holiday_year     integer NOT NULL,
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  day_portion      text NOT NULL DEFAULT 'full',
  days_recorded    numeric(6,2) NOT NULL,
  reason           text,
  note             text,
  private_note     text,
  recorded_by      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT staff_absence_sickness_day_portion_check
    CHECK (day_portion IN ('full', 'am', 'pm')),
  CONSTRAINT staff_absence_sickness_date_order_check
    CHECK (end_date >= start_date),
  CONSTRAINT staff_absence_sickness_days_positive
    CHECK (days_recorded > 0)
);

CREATE TABLE IF NOT EXISTS public.staff_leave_request_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       uuid NOT NULL REFERENCES public.staff_leave_requests(id) ON DELETE CASCADE,
  event_type       text NOT NULL,
  actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT staff_leave_request_events_type_check
    CHECK (event_type IN ('submitted', 'approved', 'rejected', 'cancelled', 'comment'))
);

CREATE INDEX IF NOT EXISTS staff_leave_request_events_request_idx
  ON public.staff_leave_request_events (request_id, created_at);

-- Prevent audit tampering.
CREATE OR REPLACE FUNCTION public.staff_leave_request_events_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Leave approval history is append-only.';
END;
$$;

DROP TRIGGER IF EXISTS staff_leave_request_events_reject_mutation_trigger
  ON public.staff_leave_request_events;

CREATE TRIGGER staff_leave_request_events_reject_mutation_trigger
  BEFORE UPDATE OR DELETE ON public.staff_leave_request_events
  FOR EACH ROW
  EXECUTE FUNCTION public.staff_leave_request_events_reject_mutation();

-- ---------------------------------------------------------------------------
-- Day counting helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_leave_pattern_for_profile(target_profile uuid)
RETURNS public.staff_working_patterns
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.*
  FROM public.staff_working_patterns p
  WHERE p.profile_id = target_profile
  ORDER BY p.effective_from DESC
  LIMIT 1;
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
  pattern := public.staff_leave_pattern_for_profile(target_profile);

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

CREATE OR REPLACE FUNCTION public.staff_leave_is_reserved_day(on_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.staff_bank_holidays bh
      WHERE bh.holiday_date = on_date
        AND bh.region = 'england_wales'
    )
    OR EXISTS (
      SELECT 1
      FROM public.staff_leave_company_closures cc
      WHERE cc.closure_date = on_date
    );
$$;

CREATE OR REPLACE FUNCTION public.staff_leave_count_request_days(
  target_profile uuid,
  start_date date,
  end_date date,
  day_portion text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cursor_date date;
  total numeric := 0;
  day_value numeric;
BEGIN
  IF day_portion <> 'full' AND start_date <> end_date THEN
    RAISE EXCEPTION 'Half-day leave must use the same start and end date.';
  END IF;

  day_value := CASE WHEN day_portion = 'full' THEN 1 ELSE 0.5 END;
  cursor_date := start_date;

  WHILE cursor_date <= end_date LOOP
    IF public.staff_leave_is_working_day(target_profile, cursor_date)
      AND NOT public.staff_leave_is_reserved_day(cursor_date) THEN
      total := total + day_value;
    END IF;
    cursor_date := cursor_date + 1;
  END LOOP;

  RETURN ROUND(total, 2);
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_leave_reserved_pool_days(target_profile uuid, holiday_year integer)
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
    WHERE bh.holiday_year = holiday_year
      AND bh.region = 'england_wales'
  LOOP
    IF public.staff_leave_is_working_day(target_profile, rec.on_date) THEN
      total := total + 1;
    END IF;
  END LOOP;

  FOR rec IN
    SELECT cc.closure_date AS on_date
    FROM public.staff_leave_company_closures cc
    WHERE cc.holiday_year = holiday_year
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

-- ---------------------------------------------------------------------------
-- Entitlement & balance
-- ---------------------------------------------------------------------------

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
BEGIN
  IF NOT skip_access_check THEN
    PERFORM public.staff_leave_assert_profile_access(target_profile);
  END IF;

  SELECT * INTO policy
  FROM public.staff_leave_policy_years py
  WHERE py.holiday_year = holiday_year;

  IF policy.holiday_year IS NULL THEN
    RAISE EXCEPTION 'Leave policy year % is not configured.', holiday_year;
  END IF;

  pattern := public.staff_leave_pattern_for_profile(target_profile);
  IF pattern.id IS NULL THEN
    pattern.fte_ratio := 1.0000;
  END IF;

  SELECT * INTO entitlement
  FROM public.staff_leave_entitlements e
  WHERE e.profile_id = target_profile
    AND e.holiday_year = holiday_year;

  reserved_pool := public.staff_leave_reserved_pool_days(target_profile, holiday_year);
  bookable := GREATEST(0, policy.gross_allowance_days - reserved_pool) * pattern.fte_ratio;

  IF entitlement.id IS NOT NULL THEN
    bookable := bookable + entitlement.adjustment_days;
    prorata := entitlement.prorata_start_date;
  END IF;

  IF prorata IS NOT NULL AND EXTRACT(YEAR FROM prorata)::integer = holiday_year THEN
    fraction := (
      (DATE (holiday_year || '-12-31')::date - prorata + 1)::numeric
      / (DATE (holiday_year || '-12-31')::date - DATE (holiday_year || '-01-01')::date + 1)::numeric
    );
    fraction := LEAST(1, GREATEST(0, fraction));
    bookable := bookable * fraction;
  END IF;

  RETURN ROUND(bookable, 2);
END;
$$;

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
    AND r.holiday_year = p_holiday_year;
$$;

CREATE OR REPLACE FUNCTION public.staff_leave_balance(
  target_profile uuid,
  p_holiday_year integer
)
RETURNS TABLE(
  holiday_year integer,
  entitlement_days numeric,
  approved_days numeric,
  pending_days numeric,
  remaining_days numeric,
  reserved_pool_days numeric,
  gross_allowance_days numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ent numeric;
  usage record;
  policy_gross numeric;
  reserved numeric;
BEGIN
  PERFORM public.staff_leave_assert_profile_access(target_profile);

  ent := public.staff_leave_entitlement_days(target_profile, p_holiday_year, true);
  SELECT * INTO usage FROM public.staff_leave_used_days(target_profile, p_holiday_year, true);
  reserved := public.staff_leave_reserved_pool_days(target_profile, p_holiday_year);

  SELECT py.gross_allowance_days INTO policy_gross
  FROM public.staff_leave_policy_years py
  WHERE py.holiday_year = p_holiday_year;

  RETURN QUERY
  SELECT
    p_holiday_year,
    ent,
    ROUND(COALESCE(usage.approved_days, 0), 2),
    ROUND(COALESCE(usage.pending_days, 0), 2),
    ROUND(ent - COALESCE(usage.approved_days, 0) - COALESCE(usage.pending_days, 0), 2),
    reserved,
    policy_gross;
END;
$$;

-- ---------------------------------------------------------------------------
-- Mutation RPCs
-- ---------------------------------------------------------------------------

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
  overlap_exists boolean;
  hy integer := EXTRACT(YEAR FROM p_start_date)::integer;
BEGIN
  IF actor IS NULL OR NOT public.is_approved_staff() THEN
    RAISE EXCEPTION 'Only approved staff can submit leave requests.';
  END IF;

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

  SELECT EXISTS (
    SELECT 1
    FROM public.staff_leave_requests r
    WHERE r.profile_id = actor
      AND r.status IN ('pending', 'approved')
      AND p_start_date <= r.end_date
      AND r.start_date <= p_end_date
  ) INTO overlap_exists;

  IF overlap_exists THEN
    RAISE EXCEPTION 'These dates overlap an existing pending or approved request.';
  END IF;

  SELECT * INTO bal FROM public.staff_leave_balance(actor, hy);

  IF bal.remaining_days - days < 0 THEN
    RAISE EXCEPTION 'Insufficient remaining leave balance.';
  END IF;

  INSERT INTO public.staff_leave_requests (
    profile_id,
    holiday_year,
    status,
    start_date,
    end_date,
    day_portion,
    days_requested,
    employee_note
  )
  VALUES (
    actor,
    hy,
    'pending',
    p_start_date,
    p_end_date,
    p_day_portion,
    days,
    NULLIF(btrim(p_employee_note), '')
  )
  RETURNING * INTO new_request;

  INSERT INTO public.staff_leave_request_events (request_id, event_type, actor_profile_id, payload)
  VALUES (
    new_request.id,
    'submitted',
    actor,
    jsonb_build_object('days_requested', days, 'day_portion', p_day_portion)
  );

  RETURN new_request;
END;
$$;

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
BEGIN
  IF actor IS NULL OR NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Only approved admins can approve or decline leave.';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected.';
  END IF;

  SELECT r.profile_id INTO owner_id
  FROM public.staff_leave_requests r
  WHERE r.id = p_request_id;

  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Leave request was not found.';
  END IF;

  IF owner_id = actor THEN
    RAISE EXCEPTION 'Approvers cannot decide their own leave request.';
  END IF;

  UPDATE public.staff_leave_requests r
  SET
    status = p_decision,
    decision_note = NULLIF(btrim(p_decision_note), ''),
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
    jsonb_build_object('decision_note', NULLIF(btrim(p_decision_note), ''))
  );

  RETURN updated_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_staff_absence_sickness(
  p_profile_id uuid,
  p_start_date date,
  p_end_date date,
  p_day_portion text,
  p_reason text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_private_note text DEFAULT NULL
)
RETURNS public.staff_absence_sickness
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  row public.staff_absence_sickness;
  days numeric;
  hy integer := EXTRACT(YEAR FROM p_start_date)::integer;
BEGIN
  IF actor IS NULL OR NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Only approved admins can record sickness absence.';
  END IF;

  IF p_day_portion NOT IN ('full', 'am', 'pm') THEN
    RAISE EXCEPTION 'Invalid day portion.';
  END IF;

  days := public.staff_leave_count_request_days(p_profile_id, p_start_date, p_end_date, p_day_portion);
  IF days <= 0 THEN
    RAISE EXCEPTION 'The selected dates do not include any working days.';
  END IF;

  INSERT INTO public.staff_absence_sickness (
    profile_id,
    holiday_year,
    start_date,
    end_date,
    day_portion,
    days_recorded,
    reason,
    note,
    private_note,
    recorded_by
  )
  VALUES (
    p_profile_id,
    hy,
    p_start_date,
    p_end_date,
    p_day_portion,
    days,
    NULLIF(btrim(p_reason), ''),
    NULLIF(btrim(p_note), ''),
    NULLIF(btrim(p_private_note), ''),
    actor
  )
  RETURNING * INTO row;

  RETURN row;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_staff_absence_sickness_own(p_holiday_year integer DEFAULT NULL)
RETURNS TABLE(
  id uuid,
  holiday_year integer,
  start_date date,
  end_date date,
  day_portion text,
  days_recorded numeric,
  reason text,
  note text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR NOT public.is_approved_staff() THEN
    RAISE EXCEPTION 'Only approved staff can view sickness history.';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.holiday_year,
    s.start_date,
    s.end_date,
    s.day_portion,
    s.days_recorded,
    s.reason,
    s.note,
    s.created_at
  FROM public.staff_absence_sickness s
  WHERE s.profile_id = actor
    AND (p_holiday_year IS NULL OR s.holiday_year = p_holiday_year)
  ORDER BY s.start_date DESC, s.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_staff_absence_sickness_admin(
  p_profile_id uuid,
  p_holiday_year integer DEFAULT NULL
)
RETURNS SETOF public.staff_absence_sickness
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Only approved admins can view sickness records.';
  END IF;

  RETURN QUERY
  SELECT s.*
  FROM public.staff_absence_sickness s
  WHERE s.profile_id = p_profile_id
    AND (p_holiday_year IS NULL OR s.holiday_year = p_holiday_year)
  ORDER BY s.start_date DESC, s.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_absence_sickness_year_total(
  p_profile_id uuid,
  p_holiday_year integer
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR NOT public.is_approved_staff() THEN
    RAISE EXCEPTION 'Unauthorized.';
  END IF;

  IF p_profile_id <> actor AND NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Forbidden.';
  END IF;

  RETURN COALESCE(
    (
      SELECT ROUND(SUM(s.days_recorded), 2)
      FROM public.staff_absence_sickness s
      WHERE s.profile_id = p_profile_id
        AND s.holiday_year = p_holiday_year
    ),
    0
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Triggers: block direct status tampering
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_leave_requests_reject_direct_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT public.staff_leave_block_direct_client_write() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Use submit_staff_leave_request to create requests.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
      OR NEW.days_requested IS DISTINCT FROM OLD.days_requested
      OR NEW.decided_by IS DISTINCT FROM OLD.decided_by
      OR NEW.decided_at IS DISTINCT FROM OLD.decided_at THEN
      RAISE EXCEPTION 'Use leave RPC functions to change request status or days.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_leave_request_events_reject_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT public.staff_leave_block_direct_client_write() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Leave approval history is append-only through RPC functions.';
END;
$$;

DROP TRIGGER IF EXISTS staff_leave_request_events_reject_insert_trigger
  ON public.staff_leave_request_events;

CREATE TRIGGER staff_leave_request_events_reject_insert_trigger
  BEFORE INSERT ON public.staff_leave_request_events
  FOR EACH ROW
  EXECUTE FUNCTION public.staff_leave_request_events_reject_insert();

DROP TRIGGER IF EXISTS staff_leave_requests_reject_direct_write_trigger
  ON public.staff_leave_requests;

CREATE TRIGGER staff_leave_requests_reject_direct_write_trigger
  BEFORE INSERT OR UPDATE ON public.staff_leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.staff_leave_requests_reject_direct_write();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.staff_leave_policy_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_bank_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_leave_company_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_working_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_leave_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_absence_sickness ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_leave_request_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_leave_policy_years_select_staff
  ON public.staff_leave_policy_years
  FOR SELECT TO authenticated
  USING (public.is_approved_staff());

CREATE POLICY staff_bank_holidays_select_staff
  ON public.staff_bank_holidays
  FOR SELECT TO authenticated
  USING (public.is_approved_staff());

CREATE POLICY staff_leave_company_closures_select_staff
  ON public.staff_leave_company_closures
  FOR SELECT TO authenticated
  USING (public.is_approved_staff());

CREATE POLICY staff_working_patterns_select
  ON public.staff_working_patterns
  FOR SELECT TO authenticated
  USING (
    public.is_approved_candid_admin()
    OR profile_id = auth.uid()
  );

CREATE POLICY staff_working_patterns_admin_write
  ON public.staff_working_patterns
  FOR ALL TO authenticated
  USING (public.is_approved_candid_admin())
  WITH CHECK (public.is_approved_candid_admin());

CREATE POLICY staff_leave_entitlements_select
  ON public.staff_leave_entitlements
  FOR SELECT TO authenticated
  USING (
    public.is_approved_candid_admin()
    OR profile_id = auth.uid()
  );

CREATE POLICY staff_leave_entitlements_admin_write
  ON public.staff_leave_entitlements
  FOR ALL TO authenticated
  USING (public.is_approved_candid_admin())
  WITH CHECK (public.is_approved_candid_admin());

CREATE POLICY staff_leave_requests_select
  ON public.staff_leave_requests
  FOR SELECT TO authenticated
  USING (
    public.is_approved_candid_admin()
    OR profile_id = auth.uid()
  );

CREATE POLICY staff_absence_sickness_admin_select
  ON public.staff_absence_sickness
  FOR SELECT TO authenticated
  USING (public.is_approved_candid_admin());

CREATE POLICY staff_leave_request_events_select
  ON public.staff_leave_request_events
  FOR SELECT TO authenticated
  USING (
    public.is_approved_candid_admin()
    OR EXISTS (
      SELECT 1
      FROM public.staff_leave_requests r
      WHERE r.id = request_id
        AND r.profile_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE public.staff_leave_requests FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.staff_leave_requests FROM authenticated;

REVOKE ALL ON TABLE public.staff_leave_request_events FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.staff_leave_request_events FROM authenticated;

REVOKE ALL ON TABLE public.staff_absence_sickness FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.staff_absence_sickness FROM authenticated;
GRANT SELECT ON TABLE public.staff_absence_sickness TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_absence_sickness_reject_direct_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT public.staff_leave_block_direct_client_write() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Use record_staff_absence_sickness to record sickness.';
END;
$$;

DROP TRIGGER IF EXISTS staff_absence_sickness_reject_direct_insert_trigger
  ON public.staff_absence_sickness;

CREATE TRIGGER staff_absence_sickness_reject_direct_insert_trigger
  BEFORE INSERT ON public.staff_absence_sickness
  FOR EACH ROW
  EXECUTE FUNCTION public.staff_absence_sickness_reject_direct_insert();

GRANT SELECT ON TABLE public.staff_leave_policy_years TO authenticated;
GRANT SELECT ON TABLE public.staff_bank_holidays TO authenticated;
GRANT SELECT ON TABLE public.staff_leave_company_closures TO authenticated;
GRANT SELECT ON TABLE public.staff_working_patterns TO authenticated;
GRANT SELECT ON TABLE public.staff_leave_entitlements TO authenticated;
GRANT SELECT ON TABLE public.staff_leave_requests TO authenticated;
GRANT SELECT ON TABLE public.staff_leave_request_events TO authenticated;

GRANT EXECUTE ON FUNCTION public.submit_staff_leave_request(date, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_staff_leave_request(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_staff_absence_sickness(uuid, date, date, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_staff_absence_sickness_own(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_staff_absence_sickness_admin(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_absence_sickness_year_total(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_leave_balance(uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.submit_staff_leave_request(date, date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_leave_entitlement_days(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_leave_used_days(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_leave_pattern_for_profile(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_leave_is_working_day(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_leave_is_reserved_day(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_leave_count_request_days(uuid, date, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_leave_reserved_pool_days(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_leave_assert_profile_access(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decide_staff_leave_request(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_staff_absence_sickness(uuid, date, date, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_staff_absence_sickness_own(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_staff_absence_sickness_admin(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_absence_sickness_year_total(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_leave_balance(uuid, integer) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.staff_leave_block_direct_client_write() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seed 2027 policy, bank holidays (GOV.UK), and Christmas 2027 closures.
-- Bookable allowance: 28 gross − 8 bank holidays − 3 compulsory closure days = 17.
-- 31 Dec 2027 paid_gift does not reduce bookable allowance.
-- ---------------------------------------------------------------------------

INSERT INTO public.staff_leave_policy_years (
  holiday_year,
  gross_allowance_days,
  reserved_closure_slots,
  notes
)
VALUES (
  2027,
  28,
  3,
  'Mon–Fri full-time: 28 days incl. bank holidays; 3 compulsory Christmas closure days; 1 gifted paid closure (31 Dec); reopen 4 Jan 2028.'
)
ON CONFLICT (holiday_year) DO NOTHING;

INSERT INTO public.staff_bank_holidays (holiday_year, holiday_date, name, region)
VALUES
  (2027, DATE '2027-01-01', 'New Year''s Day', 'england_wales'),
  (2027, DATE '2027-03-26', 'Good Friday', 'england_wales'),
  (2027, DATE '2027-03-29', 'Easter Monday', 'england_wales'),
  (2027, DATE '2027-05-03', 'Early May bank holiday', 'england_wales'),
  (2027, DATE '2027-05-31', 'Spring bank holiday', 'england_wales'),
  (2027, DATE '2027-08-30', 'Summer bank holiday', 'england_wales'),
  (2027, DATE '2027-12-27', 'Christmas Day (substitute day)', 'england_wales'),
  (2027, DATE '2027-12-28', 'Boxing Day (substitute day)', 'england_wales'),
  (2028, DATE '2028-01-03', 'New Year''s Day (substitute day)', 'england_wales')
ON CONFLICT (holiday_date, region) DO NOTHING;

INSERT INTO public.staff_leave_company_closures (holiday_year, closure_date, name, closure_kind)
VALUES
  (2027, DATE '2027-12-24', 'Christmas closure — compulsory annual leave', 'compulsory_leave'),
  (2027, DATE '2027-12-29', 'Christmas closure — compulsory annual leave', 'compulsory_leave'),
  (2027, DATE '2027-12-30', 'Christmas closure — compulsory annual leave', 'compulsory_leave'),
  (2027, DATE '2027-12-31', 'New Year''s Eve — paid company closure (gifted)', 'paid_gift')
ON CONFLICT (closure_date) DO NOTHING;

COMMIT;
