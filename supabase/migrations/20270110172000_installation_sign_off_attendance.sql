-- Installation sign-off attendance.
-- Test only. Existing sign-off rows stay valid: customer_attendance remains null.
-- Does not delete visits, photos, documents, snags, or sign-offs.
-- The authenticated session supplies captured_by_profile_id. Callers cannot choose it.

BEGIN;

ALTER TABLE public.installation_sign_offs
  ADD COLUMN IF NOT EXISTS customer_attendance text;

ALTER TABLE public.installation_sign_offs
  ADD COLUMN IF NOT EXISTS decline_reason text;

ALTER TABLE public.installation_sign_offs
  DROP CONSTRAINT IF EXISTS installation_sign_offs_attendance_check;

ALTER TABLE public.installation_sign_offs
  ADD CONSTRAINT installation_sign_offs_attendance_check
  CHECK (
    customer_attendance IS NULL
    OR (
      customer_attendance IN ('present', 'absent', 'declined')
      AND (
        customer_attendance <> 'present'
        OR (signature_storage_path IS NOT NULL AND btrim(signature_storage_path) <> '')
      )
      AND (
        customer_attendance = 'present'
        OR signature_storage_path IS NULL
      )
      AND (
        customer_attendance <> 'declined'
        OR (decline_reason IS NOT NULL AND btrim(decline_reason) <> '')
      )
    )
  );

DROP FUNCTION IF EXISTS public.installation_sign_off_capture(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.installation_sign_off_capture(uuid, text, text, text, text, text);

CREATE FUNCTION public.installation_sign_off_capture(
  p_visit_id uuid,
  p_customer_name text,
  p_notes text DEFAULT NULL,
  p_signature_storage_path text DEFAULT NULL,
  p_customer_attendance text DEFAULT NULL,
  p_decline_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_name text;
  v_path text;
  v_reason text;
  v_path_visit uuid;
BEGIN
  PERFORM public.installation_assert_operator();

  v_path := nullif(btrim(coalesce(p_signature_storage_path, '')), '');
  v_reason := nullif(btrim(coalesce(p_decline_reason, '')), '');

  IF p_customer_attendance IS NULL THEN
    v_name := btrim(coalesce(p_customer_name, ''));
    IF v_name = '' THEN
      RAISE EXCEPTION 'Customer name is required.';
    END IF;
  ELSIF p_customer_attendance = 'present' THEN
    v_name := btrim(coalesce(p_customer_name, ''));
    IF v_name = '' THEN
      RAISE EXCEPTION 'Customer name is required.';
    END IF;
    IF v_path IS NULL THEN
      RAISE EXCEPTION 'A handwritten signature is required when the customer is present.';
    END IF;
  ELSIF p_customer_attendance = 'absent' THEN
    v_name := 'Customer not present';
    v_path := NULL;
    v_reason := NULL;
  ELSIF p_customer_attendance = 'declined' THEN
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'Explain why the customer declined to sign.';
    END IF;
    v_name := 'Customer declined to sign';
    v_path := NULL;
  ELSE
    RAISE EXCEPTION 'Invalid customer attendance.';
  END IF;

  IF v_path IS NOT NULL THEN
    v_path_visit := public.installation_storage_visit_id_from_path(v_path);
    IF v_path_visit IS NULL OR v_path_visit IS DISTINCT FROM p_visit_id THEN
      RAISE EXCEPTION 'Signature storage path must begin with the visit id.';
    END IF;
    IF NOT public.installation_storage_path_is_valid(v_path) THEN
      RAISE EXCEPTION 'Invalid installation signature storage path.';
    END IF;
  END IF;

  INSERT INTO public.installation_sign_offs (
    installation_visit_id,
    customer_name,
    notes,
    signature_storage_path,
    captured_by_profile_id,
    customer_attendance,
    decline_reason
  )
  VALUES (
    p_visit_id,
    v_name,
    p_notes,
    v_path,
    auth.uid(),
    p_customer_attendance,
    v_reason
  )
  ON CONFLICT (installation_visit_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Sign-off already recorded for this visit.';
  END IF;

  PERFORM public.installation_append_visit_event(
    p_visit_id,
    'sign_off_captured',
    jsonb_build_object(
      'sign_off_id', v_id,
      'customer_attendance', p_customer_attendance
    )
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.installation_sign_off_capture(uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.installation_sign_off_capture(uuid, text, text, text, text, text) TO authenticated;

COMMIT;
