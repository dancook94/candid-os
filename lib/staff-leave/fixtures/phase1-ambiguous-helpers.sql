-- Minimal Phase 1 tables + ambiguous helper bodies matching what Test had before the hotfix.
CREATE TABLE IF NOT EXISTS public.staff_leave_policy_years (
  holiday_year integer PRIMARY KEY,
  gross_allowance_days numeric(6,2) NOT NULL,
  reserved_closure_slots integer NOT NULL DEFAULT 3,
  region text NOT NULL DEFAULT 'england_wales',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staff_bank_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_year integer NOT NULL,
  holiday_date date NOT NULL,
  name text NOT NULL,
  region text NOT NULL DEFAULT 'england_wales',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (holiday_date, region)
);

CREATE TABLE IF NOT EXISTS public.staff_leave_company_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_year integer NOT NULL,
  closure_date date NOT NULL,
  name text NOT NULL,
  closure_kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (closure_date)
);

CREATE TABLE IF NOT EXISTS public.staff_working_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  week_pattern jsonb NOT NULL,
  fte_ratio numeric(5,4) NOT NULL DEFAULT 1.0000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staff_leave_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  holiday_year integer NOT NULL,
  adjustment_days numeric(6,2) NOT NULL DEFAULT 0,
  prorata_start_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, holiday_year)
);

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

CREATE OR REPLACE FUNCTION public.staff_leave_is_working_day(target_profile uuid, on_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXTRACT(ISODOW FROM on_date) BETWEEN 1 AND 5;
$$;

CREATE OR REPLACE FUNCTION public.staff_leave_assert_profile_access(target_profile uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NULL;
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
  reserved_pool numeric;
BEGIN
  SELECT * INTO policy
  FROM public.staff_leave_policy_years py
  WHERE py.holiday_year = holiday_year;

  reserved_pool := public.staff_leave_reserved_pool_days(target_profile, holiday_year);
  RETURN GREATEST(0, policy.gross_allowance_days - reserved_pool);
END;
$$;

INSERT INTO public.staff_leave_policy_years (holiday_year, gross_allowance_days, reserved_closure_slots)
VALUES (2027, 28, 3)
ON CONFLICT (holiday_year) DO NOTHING;
