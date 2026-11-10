-- Persist the installation completion checklist on the visit sign-off.
-- Test only. Existing sign-off rows stay valid: checklist remains null.
-- The authenticated session supplies who confirmed the checklist.
-- signed_at supplies when. Callers cannot choose either value.
-- Does not delete visits, photos, documents, snags, or sign-offs.

BEGIN;

ALTER TABLE public.installation_sign_offs
  ADD COLUMN IF NOT EXISTS checklist jsonb;

ALTER TABLE public.installation_sign_offs
  DROP CONSTRAINT IF EXISTS installation_sign_offs_checklist_check;

ALTER TABLE public.installation_sign_offs
  ADD CONSTRAINT installation_sign_offs_checklist_check
  CHECK (
    checklist IS NULL
    OR (
      jsonb_typeof(checklist) = 'object'
      AND checklist->>'site_left_safe_and_tidy' = 'true'
      AND checklist->>'installation_photos_recorded' = 'true'
    )
  );

DROP FUNCTION IF EXISTS public.installation_sign_off_capture(uuid, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.installation_sign_off_capture(uuid, text, text, text, text, text, jsonb);

CREATE FUNCTION public.installation_sign_off_capture(
  p_visit_id uuid,
  p_customer_name text,
  p_notes text DEFAULT NULL,
  p_signature_storage_path text DEFAULT NULL,
  p_customer_attendance text DEFAULT NULL,
  p_decline_reason text DEFAULT NULL,
  p_checklist jsonb DEFAULT NULL
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
  v_checklist jsonb;
BEGIN
  PERFORM public.installation_assert_operator();

  v_path := nullif(btrim(coalesce(p_signature_storage_path, '')), '');
  v_reason := nullif(btrim(coalesce(p_decline_reason, '')), '');
  v_checklist := NULL;

  IF p_customer_attendance IS NULL THEN
    v_name := btrim(coalesce(p_customer_name, ''));
    IF v_name = '' THEN
      RAISE EXCEPTION 'Customer name is required.';
    END IF;
  ELSE
    IF p_checklist IS NULL
      OR jsonb_typeof(p_checklist) IS DISTINCT FROM 'object'
      OR COALESCE(p_checklist->>'site_left_safe_and_tidy', '') IS DISTINCT FROM 'true'
      OR COALESCE(p_checklist->>'installation_photos_recorded', '') IS DISTINCT FROM 'true'
    THEN
      RAISE EXCEPTION 'Complete the checklist before sign-off.';
    END IF;
    v_checklist := jsonb_build_object(
      'site_left_safe_and_tidy', true,
      'installation_photos_recorded', true
    );

    IF p_customer_attendance = 'present' THEN
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
    decline_reason,
    checklist
  )
  VALUES (
    p_visit_id,
    v_name,
    p_notes,
    v_path,
    auth.uid(),
    p_customer_attendance,
    v_reason,
    v_checklist
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
      'customer_attendance', p_customer_attendance,
      'checklist', v_checklist,
      'confirmed_by_profile_id', auth.uid()
    )
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.installation_sign_off_capture(uuid, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.installation_sign_off_capture(uuid, text, text, text, text, text, jsonb) TO authenticated;

DROP FUNCTION IF EXISTS public.installation_discard_unlinked_signature(uuid, text);

-- A saved signature cannot be removed, including by a manager.
DROP POLICY IF EXISTS installation_files_delete_manager ON storage.objects;
CREATE POLICY installation_files_delete_manager
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'installation-files'
    AND public.is_approved_installation_manager()
    AND NOT EXISTS (
      SELECT 1
      FROM public.installation_sign_offs
      WHERE signature_storage_path = name
    )
  );

-- Operators may remove only an unlinked signature image.
DROP POLICY IF EXISTS installation_files_delete_unlinked_signature ON storage.objects;
CREATE POLICY installation_files_delete_unlinked_signature
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'installation-files'
    AND public.is_approved_installation_operator()
    AND name LIKE '%/documents/other/%customer-signature.png'
    AND public.installation_storage_visit_id_from_path(name) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.installation_sign_offs
      WHERE signature_storage_path = name
    )
  );

COMMIT;
