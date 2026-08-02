-- Proposed migration: multi-assignee tasks via task_assignees join table
-- Apply manually in Supabase. Do not run automatically from the app.
--
-- Phase 1 (this file):
--   - Create task_assignees
--   - Backfill from tasks.assigned_to
--   - Add RLS policies
--   - Extend task access policies to include assignees
--
-- Phase 2 (future cleanup — not in this migration):
--   - Drop tasks.assigned_to after all app code reads task_assignees only
--   - Remove compatibility writes to tasks.assigned_to

BEGIN;

-- ---------------------------------------------------------------------------
-- task_assignees
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.task_assignees (
  task_id      uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  assigned_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (task_id, profile_id)
);

CREATE INDEX IF NOT EXISTS task_assignees_profile_id_idx
  ON public.task_assignees (profile_id);

CREATE INDEX IF NOT EXISTS task_assignees_task_id_idx
  ON public.task_assignees (task_id);

-- Validate assignees are approved CRM staff (mirrors tasks trigger pattern)
CREATE OR REPLACE FUNCTION public.validate_task_assignee_profile_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.validate_crm_staff_profile_id(NEW.profile_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS task_assignees_validate_profile ON public.task_assignees;

CREATE TRIGGER task_assignees_validate_profile
  BEFORE INSERT OR UPDATE OF profile_id
  ON public.task_assignees
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_task_assignee_profile_id();

-- Backfill existing single assignees from tasks.assigned_to
INSERT INTO public.task_assignees (task_id, profile_id, assigned_at, assigned_by)
SELECT
  t.id,
  t.assigned_to,
  t.created_at,
  t.created_by
FROM public.tasks t
ON CONFLICT (task_id, profile_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Helper: check whether current user is assigned via join table
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_task_assignee(target_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.task_assignees ta
    WHERE ta.task_id = target_task_id
      AND ta.profile_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS: task_assignees
-- ---------------------------------------------------------------------------

ALTER TABLE public.task_assignees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "CRM admins full access to task assignees"
  ON public.task_assignees
  FOR ALL
  TO authenticated
  USING (public.is_approved_crm_admin())
  WITH CHECK (public.is_approved_crm_admin());

CREATE POLICY "CRM sales manage assignees on accessible tasks"
  ON public.task_assignees
  FOR ALL
  TO authenticated
  USING (
    public.is_approved_crm_staff()
    AND EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_assignees.task_id
        AND (
          t.assigned_to = auth.uid()
          OR t.created_by = auth.uid()
          OR public.is_task_assignee(t.id)
          OR (
            t.opportunity_id IS NOT NULL
            AND public.can_access_opportunity(t.opportunity_id)
          )
        )
    )
  )
  WITH CHECK (
    public.is_approved_crm_staff()
    AND EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = task_assignees.task_id
        AND (
          t.assigned_to = auth.uid()
          OR t.created_by = auth.uid()
          OR public.is_task_assignee(t.id)
          OR (
            t.opportunity_id IS NOT NULL
            AND public.can_access_opportunity(t.opportunity_id)
          )
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Extend existing tasks policies to honour task_assignees
-- (Keep assigned_to checks for transition compatibility)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "CRM sales read related tasks" ON public.tasks;
DROP POLICY IF EXISTS "CRM sales update related tasks" ON public.tasks;

CREATE POLICY "CRM sales read related tasks"
  ON public.tasks
  FOR SELECT
  TO authenticated
  USING (
    public.is_approved_crm_staff()
    AND (
      assigned_to = auth.uid()
      OR created_by = auth.uid()
      OR public.is_task_assignee(id)
      OR (
        opportunity_id IS NOT NULL
        AND public.can_access_opportunity(opportunity_id)
      )
    )
  );

CREATE POLICY "CRM sales update related tasks"
  ON public.tasks
  FOR UPDATE
  TO authenticated
  USING (
    public.is_approved_crm_staff()
    AND (
      assigned_to = auth.uid()
      OR created_by = auth.uid()
      OR public.is_task_assignee(id)
      OR (
        opportunity_id IS NOT NULL
        AND public.can_access_opportunity(opportunity_id)
      )
    )
  )
  WITH CHECK (public.is_approved_crm_staff());

COMMIT;
