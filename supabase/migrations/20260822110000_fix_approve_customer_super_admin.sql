-- Fix approve_customer RPC authorization for super_admin and admin.
-- Apply manually in Supabase if the RPC still rejects approved super_admin users.

CREATE OR REPLACE FUNCTION public.is_approved_crm_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.account_status = 'approved'
      AND p.user_role IN ('super_admin', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.approve_customer(
  profile_id uuid,
  selected_company_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_profile public.profiles%ROWTYPE;
BEGIN
  IF NOT public.is_approved_crm_admin() THEN
    RAISE EXCEPTION 'Only approved administrators can approve customers';
  END IF;

  SELECT *
  INTO target_profile
  FROM public.profiles
  WHERE id = profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer profile not found';
  END IF;

  IF target_profile.user_role <> 'customer' THEN
    RAISE EXCEPTION 'Only customer profiles can be approved';
  END IF;

  IF target_profile.account_status = 'approved' THEN
    RAISE EXCEPTION 'Customer is already approved';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id = selected_company_id
      AND c.is_active = true
  ) THEN
    RAISE EXCEPTION 'Company not found or inactive';
  END IF;

  UPDATE public.profiles
  SET
    account_status = 'approved',
    company_id = selected_company_id,
    updated_at = now()
  WHERE id = profile_id;
END;
$$;
