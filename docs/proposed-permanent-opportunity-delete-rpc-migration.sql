-- Transactional permanent opportunity deletion (RPC)
-- Review and apply manually in Supabase.
-- DO NOT run automatically.
--
-- Prerequisites:
--   docs/proposed-crm-notes-activity-migration.sql
--   docs/proposed-crm-foundation-migration.sql
--
-- Changes:
--   1. crm_activity.opportunity_id FK: CASCADE → SET NULL
--   2. crm_notes.opportunity_id FK: CASCADE → SET NULL
--   3. Immutability trigger: allow FK-driven opportunity_id nullification
--   4. permanently_delete_opportunity() RPC (single transaction)

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. opportunity_id FKs: preserve linked rows on opportunity delete
-- ---------------------------------------------------------------------------

ALTER TABLE public.crm_activity
  DROP CONSTRAINT IF EXISTS crm_activity_opportunity_id_fkey;

ALTER TABLE public.crm_activity
  ADD CONSTRAINT crm_activity_opportunity_id_fkey
  FOREIGN KEY (opportunity_id)
  REFERENCES public.opportunities(id)
  ON DELETE SET NULL;

COMMENT ON CONSTRAINT crm_activity_opportunity_id_fkey ON public.crm_activity IS
  'Preserve activity when opportunities are deleted; opportunity_id is cleared, metadata keeps context.';

ALTER TABLE public.crm_notes
  DROP CONSTRAINT IF EXISTS crm_notes_opportunity_id_fkey;

ALTER TABLE public.crm_notes
  ADD CONSTRAINT crm_notes_opportunity_id_fkey
  FOREIGN KEY (opportunity_id)
  REFERENCES public.opportunities(id)
  ON DELETE SET NULL;

COMMENT ON CONSTRAINT crm_notes_opportunity_id_fkey ON public.crm_notes IS
  'Preserve notes when opportunities are deleted; opportunity_id is cleared when other links remain.';

-- ---------------------------------------------------------------------------
-- 2. Immutability trigger: permit FK-driven opportunity_id SET NULL
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_crm_activity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.quote_id IS NOT NULL
     AND NEW.quote_id IS NULL
     AND to_jsonb(OLD) - 'quote_id' = to_jsonb(NEW) - 'quote_id'
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.opportunity_id IS NOT NULL
     AND NEW.opportunity_id IS NULL
     AND to_jsonb(OLD) - 'opportunity_id' = to_jsonb(NEW) - 'opportunity_id'
  THEN
    RETURN NEW;
  END IF;

  IF public.is_approved_crm_admin() THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'CRM activity is immutable and cannot be updated or deleted'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. permanently_delete_opportunity RPC
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.permanently_delete_opportunity(
  p_opportunity_id uuid,
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
  v_opportunity public.opportunities%ROWTYPE;
  v_linked_quote_count integer;
  v_open_task_count integer;
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
  INTO v_opportunity
  FROM public.opportunities
  WHERE id = p_opportunity_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opportunity not found.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*)
  INTO v_linked_quote_count
  FROM public.quotes q
  WHERE q.opportunity_id = p_opportunity_id;

  IF v_linked_quote_count > 0 THEN
    RAISE EXCEPTION
      'This opportunity has linked quotes and cannot be deleted until they are removed or reassigned.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*)
  INTO v_open_task_count
  FROM public.tasks t
  WHERE t.opportunity_id = p_opportunity_id
    AND t.status IN ('open', 'in_progress');

  IF v_open_task_count > 0 THEN
    RAISE EXCEPTION
      'This opportunity has open tasks. Complete, cancel, or reassign them before deletion.'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.crm_activity (
    activity_type,
    description,
    metadata,
    company_id,
    contact_id,
    actor_profile_id
  )
  VALUES (
    'opportunity_deleted',
    btrim(p_description),
    COALESCE(p_metadata, '{}'::jsonb),
    v_opportunity.company_id,
    v_opportunity.contact_id,
    p_deleted_by
  );

  UPDATE public.crm_notes cn
  SET
    company_id = COALESCE(cn.company_id, v_opportunity.company_id),
    contact_id = COALESCE(cn.contact_id, v_opportunity.contact_id),
    opportunity_id = NULL
  WHERE cn.opportunity_id = p_opportunity_id;

  UPDATE public.crm_activity ca
  SET opportunity_id = NULL
  WHERE ca.opportunity_id = p_opportunity_id;

  UPDATE public.tasks t
  SET
    company_id = COALESCE(t.company_id, v_opportunity.company_id),
    quote_id = NULL,
    opportunity_id = NULL
  WHERE t.opportunity_id = p_opportunity_id
    AND t.status IN ('completed', 'cancelled');

  DELETE FROM public.opportunity_members om
  WHERE om.opportunity_id = p_opportunity_id;

  DELETE FROM public.opportunities o
  WHERE o.id = p_opportunity_id;
END;
$$;

COMMENT ON FUNCTION public.permanently_delete_opportunity IS
  'Atomically records opportunity_deleted activity, detaches CRM links, and removes the opportunity.';

REVOKE ALL ON FUNCTION public.permanently_delete_opportunity(uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.permanently_delete_opportunity(uuid, uuid, text, jsonb) TO authenticated;

COMMIT;
