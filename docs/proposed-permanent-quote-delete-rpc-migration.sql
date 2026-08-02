-- Transactional permanent quote deletion (RPC)
-- Review and apply manually in Supabase.
-- DO NOT run automatically.
--
-- Requires docs/proposed-crm-activity-quote-id-set-null-migration.sql so quote
-- deletion clears crm_activity.quote_id instead of deleting activity rows.
--
-- Guarantees:
--   - quote_deleted activity is inserted, then quote_items, quote_versions and
--     quotes are removed in one transaction
--   - any failure rolls back the entire operation
--   - crm_activity rows are preserved (quote_id SET NULL on quote delete)

BEGIN;

CREATE OR REPLACE FUNCTION public.permanently_delete_quote(
  p_quote_id uuid,
  p_deleted_by uuid,
  p_description text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote public.quotes%ROWTYPE;
  v_version_ids uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.is_approved_crm_admin() THEN
    RAISE EXCEPTION 'Admin access required.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT *
  INTO v_quote
  FROM public.quotes
  WHERE id = p_quote_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found.'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.crm_activity (
    activity_type,
    description,
    metadata,
    company_id,
    contact_id,
    opportunity_id,
    quote_id,
    actor_profile_id
  )
  VALUES (
    'quote_deleted',
    btrim(p_description),
    COALESCE(p_metadata, '{}'::jsonb),
    v_quote.company_id,
    v_quote.contact_id,
    v_quote.opportunity_id,
    v_quote.id,
    p_deleted_by
  );

  SELECT coalesce(array_agg(qv.id), ARRAY[]::uuid[])
  INTO v_version_ids
  FROM public.quote_versions qv
  WHERE qv.quote_id = p_quote_id;

  IF cardinality(v_version_ids) > 0 THEN
    DELETE FROM public.quote_items qi
    WHERE qi.quote_version_id = ANY (v_version_ids);

    DELETE FROM public.quote_versions qv
    WHERE qv.quote_id = p_quote_id;
  END IF;

  DELETE FROM public.quotes q
  WHERE q.id = p_quote_id;
END;
$$;

COMMENT ON FUNCTION public.permanently_delete_quote IS
  'Atomically records quote_deleted activity and removes quote_items, quote_versions and quotes.';

CREATE OR REPLACE FUNCTION public.delete_broken_quote(p_quote_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote public.quotes%ROWTYPE;
  v_version_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.is_approved_crm_admin() THEN
    RAISE EXCEPTION 'Admin access required.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT *
  INTO v_quote
  FROM public.quotes
  WHERE id = p_quote_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*)
  INTO v_version_count
  FROM public.quote_versions qv
  WHERE qv.quote_id = p_quote_id;

  IF v_version_count > 0 THEN
    RAISE EXCEPTION 'Quote has versions. Use permanent delete instead.'
      USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM public.quotes q
  WHERE q.id = p_quote_id;
END;
$$;

COMMENT ON FUNCTION public.delete_broken_quote IS
  'Removes orphaned quote rows that have no quote_versions (repair helper).';

REVOKE ALL ON FUNCTION public.permanently_delete_quote(uuid, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_broken_quote(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.permanently_delete_quote(uuid, uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_broken_quote(uuid) TO authenticated;

COMMIT;
