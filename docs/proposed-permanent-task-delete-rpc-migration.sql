-- Transactional permanent task deletion (RPC)
-- Review and apply manually in Supabase.
-- DO NOT run automatically.
--
-- Prerequisites:
--   docs/proposed-crm-notes-activity-migration.sql
--   docs/proposed-crm-foundation-migration.sql
--   docs/proposed-task-assignees-migration.sql (recommended)
--
-- Changes:
--   1. crm_activity.task_id FK: CASCADE → SET NULL
--   2. crm_notes.task_id FK: CASCADE → SET NULL
--   3. Immutability trigger: allow FK-driven task_id nullification
--   4. permanently_delete_task() RPC (single transaction)

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. task_id FKs: preserve linked rows on task delete
-- ---------------------------------------------------------------------------

ALTER TABLE public.crm_activity
  DROP CONSTRAINT IF EXISTS crm_activity_task_id_fkey;

ALTER TABLE public.crm_activity
  ADD CONSTRAINT crm_activity_task_id_fkey
  FOREIGN KEY (task_id)
  REFERENCES public.tasks(id)
  ON DELETE SET NULL;

COMMENT ON CONSTRAINT crm_activity_task_id_fkey ON public.crm_activity IS
  'Preserve activity when tasks are deleted; task_id is cleared, metadata keeps context.';

ALTER TABLE public.crm_notes
  DROP CONSTRAINT IF EXISTS crm_notes_task_id_fkey;

ALTER TABLE public.crm_notes
  ADD CONSTRAINT crm_notes_task_id_fkey
  FOREIGN KEY (task_id)
  REFERENCES public.tasks(id)
  ON DELETE SET NULL;

COMMENT ON CONSTRAINT crm_notes_task_id_fkey ON public.crm_notes IS
  'Preserve notes when tasks are deleted; task_id is cleared when other links remain.';

-- ---------------------------------------------------------------------------
-- 2. Immutability trigger: permit FK-driven task_id SET NULL
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

  IF TG_OP = 'UPDATE'
     AND OLD.task_id IS NOT NULL
     AND NEW.task_id IS NULL
     AND to_jsonb(OLD) - 'task_id' = to_jsonb(NEW) - 'task_id'
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
-- 3. permanently_delete_task RPC
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.permanently_delete_task(
  p_task_id uuid,
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
  v_task public.tasks%ROWTYPE;
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
  INTO v_task
  FROM public.tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found.'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.crm_activity (
    activity_type,
    description,
    metadata,
    company_id,
    opportunity_id,
    quote_id,
    actor_profile_id
  )
  VALUES (
    'task_deleted',
    btrim(p_description),
    COALESCE(p_metadata, '{}'::jsonb),
    v_task.company_id,
    v_task.opportunity_id,
    v_task.quote_id,
    p_deleted_by
  );

  UPDATE public.crm_notes cn
  SET
    company_id = COALESCE(cn.company_id, v_task.company_id),
    opportunity_id = COALESCE(cn.opportunity_id, v_task.opportunity_id),
    quote_id = COALESCE(cn.quote_id, v_task.quote_id),
    task_id = NULL
  WHERE cn.task_id = p_task_id;

  UPDATE public.crm_activity ca
  SET task_id = NULL
  WHERE ca.task_id = p_task_id;

  DELETE FROM public.task_assignees ta
  WHERE ta.task_id = p_task_id;

  DELETE FROM public.tasks t
  WHERE t.id = p_task_id;
END;
$$;

COMMENT ON FUNCTION public.permanently_delete_task IS
  'Atomically records task_deleted activity, detaches CRM links, and removes the task.';

REVOKE ALL ON FUNCTION public.permanently_delete_task(uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.permanently_delete_task(uuid, uuid, text, jsonb) TO authenticated;

COMMIT;
