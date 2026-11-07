-- Standard admin new-quote creation with transactional quote_number allocation.
-- Test release only until promoted.

BEGIN;

CREATE TABLE IF NOT EXISTS public.quote_create_requests (
  idempotency_key uuid PRIMARY KEY,
  created_quote_id uuid REFERENCES public.quotes (id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quote_create_requests_created_at_idx
  ON public.quote_create_requests (created_at DESC);

CREATE OR REPLACE FUNCTION public.create_admin_quote_draft(
  p_company_id uuid,
  p_contact_id uuid,
  p_quote_request_id uuid,
  p_opportunity_id uuid,
  p_project_name text,
  p_required_date date,
  p_idempotency_key uuid,
  p_expiry_date date,
  p_payment_terms_days integer,
  p_introduction text,
  p_customer_notes text,
  p_internal_notes text,
  p_subtotal numeric,
  p_vat_rate numeric,
  p_vat_amount numeric,
  p_total numeric
)
RETURNS TABLE (
  quote_id uuid,
  quote_number integer,
  version_id uuid
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_existing_quote_id uuid;
  v_quote_id uuid;
  v_version_id uuid;
  v_next_number integer;
  v_company_active boolean;
  v_contact_active boolean;
BEGIN
  IF NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Admin access required'
      USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Idempotency key is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_company_id IS NULL OR p_contact_id IS NULL THEN
    RAISE EXCEPTION 'Company and contact are required'
      USING ERRCODE = '22023';
  END IF;

  IF nullif(trim(p_project_name), '') IS NULL THEN
    RAISE EXCEPTION 'Project name is required'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.quote_create_requests (
    idempotency_key,
    created_by
  )
  VALUES (
    p_idempotency_key,
    auth.uid()
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT created_quote_id
  INTO v_existing_quote_id
  FROM public.quote_create_requests
  WHERE idempotency_key = p_idempotency_key
    AND created_quote_id IS NOT NULL;

  IF v_existing_quote_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.quotes AS q
      JOIN public.quote_versions AS v
        ON v.quote_id = q.id
        AND v.version_number = 1
      WHERE q.id = v_existing_quote_id
    ) THEN
      RETURN QUERY
      SELECT
        q.id,
        q.quote_number,
        v.id
      FROM public.quotes AS q
      JOIN public.quote_versions AS v
        ON v.quote_id = q.id
        AND v.version_number = 1
      WHERE q.id = v_existing_quote_id;

      RETURN;
    END IF;

    UPDATE public.quote_create_requests
    SET created_quote_id = NULL
    WHERE idempotency_key = p_idempotency_key;
  END IF;

  SELECT coalesce(is_active, false)
  INTO v_company_active
  FROM public.companies
  WHERE id = p_company_id;

  IF NOT coalesce(v_company_active, false) THEN
    RAISE EXCEPTION 'Company must be active before a quote can be created'
      USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(is_active, false)
  INTO v_contact_active
  FROM public.contacts
  WHERE id = p_contact_id
    AND company_id = p_company_id;

  IF NOT coalesce(v_contact_active, false) THEN
    RAISE EXCEPTION 'Contact must be active and belong to this company before a quote can be created'
      USING ERRCODE = '22023';
  END IF;

  v_next_number := public.allocate_next_quote_number();

  INSERT INTO public.quotes (
    quote_number,
    company_id,
    contact_id,
    quote_request_id,
    opportunity_id,
    project_name,
    required_date,
    status,
    current_version,
    created_by
  )
  VALUES (
    v_next_number,
    p_company_id,
    p_contact_id,
    p_quote_request_id,
    p_opportunity_id,
    trim(p_project_name),
    p_required_date,
    'draft',
    1,
    auth.uid()
  )
  RETURNING id INTO v_quote_id;

  INSERT INTO public.quote_versions (
    quote_id,
    version_number,
    version_status,
    introduction,
    customer_notes,
    internal_notes,
    expiry_date,
    payment_terms_days,
    subtotal,
    vat_rate,
    vat_amount,
    total,
    sent_at,
    accepted_at,
    declined_at
  )
  VALUES (
    v_quote_id,
    1,
    'draft',
    nullif(trim(p_introduction), ''),
    nullif(trim(p_customer_notes), ''),
    nullif(trim(p_internal_notes), ''),
    p_expiry_date,
    p_payment_terms_days,
    p_subtotal,
    p_vat_rate,
    p_vat_amount,
    p_total,
    NULL,
    NULL,
    NULL
  )
  RETURNING id INTO v_version_id;

  UPDATE public.quote_create_requests
  SET created_quote_id = v_quote_id
  WHERE idempotency_key = p_idempotency_key;

  RETURN QUERY
  SELECT v_quote_id, v_next_number, v_version_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_admin_quote_draft(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  date,
  uuid,
  date,
  integer,
  text,
  text,
  text,
  numeric,
  numeric,
  numeric,
  numeric
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_admin_quote_draft(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  date,
  uuid,
  date,
  integer,
  text,
  text,
  text,
  numeric,
  numeric,
  numeric,
  numeric
) TO authenticated;

ALTER TABLE public.quote_create_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_create_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_create_requests_admin ON public.quote_create_requests;
CREATE POLICY quote_create_requests_admin
  ON public.quote_create_requests
  FOR ALL
  TO authenticated
  USING (public.is_approved_candid_admin())
  WITH CHECK (public.is_approved_candid_admin());

REVOKE ALL ON TABLE public.quote_create_requests FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON TABLE public.quote_create_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.quote_create_requests TO service_role;

COMMIT;
