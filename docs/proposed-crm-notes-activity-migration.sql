-- Proposed migration: shared CRM notes and activity
-- Review and apply manually in Supabase (staging first).
-- DO NOT run automatically.
--
-- Prerequisites:
--   docs/proposed-crm-foundation-migration.sql
--   docs/proposed-contacts-migration.sql (contact_id on opportunities/quotes)
--
-- Keeps public.opportunity_notes and public.opportunity_activity during transition.
-- Run backfill (section 8) after deploy; see docs/crm-notes-activity-plan.md.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Shared CRM notes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.crm_notes (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body                        text NOT NULL,
  company_id                  uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  contact_id                  uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  opportunity_id              uuid REFERENCES public.opportunities(id) ON DELETE CASCADE,
  quote_id                    uuid REFERENCES public.quotes(id) ON DELETE CASCADE,
  task_id                     uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  created_by                  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  is_pinned                   boolean NOT NULL DEFAULT false,
  deleted_at                  timestamptz,
  deleted_by                  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  source_opportunity_note_id  uuid UNIQUE,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT crm_notes_body_not_blank CHECK (btrim(body) <> ''),
  CONSTRAINT crm_notes_at_least_one_link CHECK (
    company_id IS NOT NULL
    OR contact_id IS NOT NULL
    OR opportunity_id IS NOT NULL
    OR quote_id IS NOT NULL
    OR task_id IS NOT NULL
  ),
  CONSTRAINT crm_notes_deleted_by_consistency CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL)
    OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL)
  )
);

COMMENT ON TABLE public.crm_notes IS
  'Staff-authored CRM notes. May link to one or more related records. Soft-deleted via deleted_at.';
COMMENT ON COLUMN public.crm_notes.source_opportunity_note_id IS
  'Idempotent backfill key from opportunity_notes.id. Drop after legacy table removal.';
COMMENT ON COLUMN public.crm_notes.deleted_at IS
  'Soft delete timestamp. Deleted note body must not appear in activity metadata.';

CREATE INDEX IF NOT EXISTS crm_notes_company_created_idx
  ON public.crm_notes (company_id, created_at DESC)
  WHERE company_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS crm_notes_contact_created_idx
  ON public.crm_notes (contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS crm_notes_opportunity_created_idx
  ON public.crm_notes (opportunity_id, created_at DESC)
  WHERE opportunity_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS crm_notes_quote_created_idx
  ON public.crm_notes (quote_id, created_at DESC)
  WHERE quote_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS crm_notes_task_created_idx
  ON public.crm_notes (task_id, created_at DESC)
  WHERE task_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS crm_notes_pinned_created_idx
  ON public.crm_notes (is_pinned DESC, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS crm_notes_created_by_idx
  ON public.crm_notes (created_by, created_at DESC)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS crm_notes_set_updated_at ON public.crm_notes;
CREATE TRIGGER crm_notes_set_updated_at
  BEFORE UPDATE ON public.crm_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Shared CRM activity (append-only for normal staff)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.crm_activity (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_type                   text NOT NULL,
  description                     text NOT NULL,
  metadata                        jsonb NOT NULL DEFAULT '{}'::jsonb,
  company_id                      uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  contact_id                      uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  opportunity_id                  uuid REFERENCES public.opportunities(id) ON DELETE CASCADE,
  quote_id                        uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  task_id                         uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  actor_profile_id                uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  source_opportunity_activity_id  uuid UNIQUE,
  created_at                      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT crm_activity_type_not_blank CHECK (btrim(activity_type) <> ''),
  CONSTRAINT crm_activity_description_not_blank CHECK (btrim(description) <> ''),
  CONSTRAINT crm_activity_at_least_one_link CHECK (
    company_id IS NOT NULL
    OR contact_id IS NOT NULL
    OR opportunity_id IS NOT NULL
    OR quote_id IS NOT NULL
    OR task_id IS NOT NULL
  )
);

COMMENT ON TABLE public.crm_activity IS
  'Append-only CRM activity log across companies, contacts, opportunities, quotes and tasks.';
COMMENT ON COLUMN public.crm_activity.actor_profile_id IS
  'Staff actor. ON DELETE SET NULL preserves history when staff profiles are removed.';
COMMENT ON COLUMN public.crm_activity.source_opportunity_activity_id IS
  'Idempotent backfill key from opportunity_activity.id. Drop after legacy table removal.';
COMMENT ON COLUMN public.crm_activity.metadata IS
  'Structured context only. Never store secrets, tokens, email bodies or auth data.';

CREATE INDEX IF NOT EXISTS crm_activity_company_created_idx
  ON public.crm_activity (company_id, created_at DESC)
  WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_activity_contact_created_idx
  ON public.crm_activity (contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_activity_opportunity_created_idx
  ON public.crm_activity (opportunity_id, created_at DESC)
  WHERE opportunity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_activity_quote_created_idx
  ON public.crm_activity (quote_id, created_at DESC)
  WHERE quote_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_activity_task_created_idx
  ON public.crm_activity (task_id, created_at DESC)
  WHERE task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_activity_type_created_idx
  ON public.crm_activity (activity_type, created_at DESC);

CREATE INDEX IF NOT EXISTS crm_activity_actor_created_idx
  ON public.crm_activity (actor_profile_id, created_at DESC)
  WHERE actor_profile_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Link validation and company denormalisation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.derive_crm_company_id(
  p_company_id uuid,
  p_contact_id uuid,
  p_opportunity_id uuid,
  p_quote_id uuid,
  p_task_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  derived uuid;
BEGIN
  IF p_company_id IS NOT NULL THEN
    RETURN p_company_id;
  END IF;

  IF p_opportunity_id IS NOT NULL THEN
    SELECT o.company_id INTO derived
    FROM public.opportunities o
    WHERE o.id = p_opportunity_id;
    IF derived IS NOT NULL THEN
      RETURN derived;
    END IF;
  END IF;

  IF p_quote_id IS NOT NULL THEN
    SELECT q.company_id INTO derived
    FROM public.quotes q
    WHERE q.id = p_quote_id;
    IF derived IS NOT NULL THEN
      RETURN derived;
    END IF;
  END IF;

  IF p_contact_id IS NOT NULL THEN
    SELECT c.company_id INTO derived
    FROM public.contacts c
    WHERE c.id = p_contact_id;
    IF derived IS NOT NULL THEN
      RETURN derived;
    END IF;
  END IF;

  IF p_task_id IS NOT NULL THEN
    SELECT COALESCE(t.company_id, o.company_id) INTO derived
    FROM public.tasks t
    LEFT JOIN public.opportunities o ON o.id = t.opportunity_id
    WHERE t.id = p_task_id;
    IF derived IS NOT NULL THEN
      RETURN derived;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_crm_record_links()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  contact_company_id uuid;
  opportunity_company_id uuid;
  quote_company_id uuid;
  quote_opportunity_id uuid;
  task_company_id uuid;
  task_opportunity_id uuid;
  task_quote_id uuid;
  derived_company_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'crm_notes' AND NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  derived_company_id := public.derive_crm_company_id(
    NEW.company_id,
    NEW.contact_id,
    NEW.opportunity_id,
    NEW.quote_id,
    NEW.task_id
  );

  IF NEW.company_id IS NULL AND derived_company_id IS NOT NULL THEN
    NEW.company_id := derived_company_id;
  END IF;

  IF NEW.contact_id IS NOT NULL THEN
    SELECT c.company_id
    INTO contact_company_id
    FROM public.contacts c
    WHERE c.id = NEW.contact_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CRM link contact % not found', NEW.contact_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NEW.company_id IS NOT NULL AND contact_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'Contact must belong to the linked company'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.opportunity_id IS NOT NULL THEN
    SELECT o.company_id
    INTO opportunity_company_id
    FROM public.opportunities o
    WHERE o.id = NEW.opportunity_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CRM link opportunity % not found', NEW.opportunity_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NEW.company_id IS NOT NULL AND opportunity_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'Opportunity must belong to the linked company'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.quote_id IS NOT NULL THEN
    SELECT q.company_id, q.opportunity_id
    INTO quote_company_id, quote_opportunity_id
    FROM public.quotes q
    WHERE q.id = NEW.quote_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CRM link quote % not found', NEW.quote_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NEW.company_id IS NOT NULL AND quote_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'Quote must belong to the linked company'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.opportunity_id IS NOT NULL
      AND quote_opportunity_id IS NOT NULL
      AND quote_opportunity_id IS DISTINCT FROM NEW.opportunity_id THEN
      RAISE EXCEPTION 'Quote must belong to the linked opportunity when both are set'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.task_id IS NOT NULL THEN
    SELECT t.company_id, t.opportunity_id, t.quote_id
    INTO task_company_id, task_opportunity_id, task_quote_id
    FROM public.tasks t
    WHERE t.id = NEW.task_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CRM link task % not found', NEW.task_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NEW.company_id IS NOT NULL
      AND task_company_id IS NOT NULL
      AND task_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'Task must belong to the linked company'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.opportunity_id IS NOT NULL
      AND task_opportunity_id IS NOT NULL
      AND task_opportunity_id IS DISTINCT FROM NEW.opportunity_id THEN
      RAISE EXCEPTION 'Task must belong to the linked opportunity when both are set'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.quote_id IS NOT NULL
      AND task_quote_id IS NOT NULL
      AND task_quote_id IS DISTINCT FROM NEW.quote_id THEN
      RAISE EXCEPTION 'Task must belong to the linked quote when both are set'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_notes_validate_links ON public.crm_notes;
CREATE TRIGGER crm_notes_validate_links
  BEFORE INSERT OR UPDATE ON public.crm_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_crm_record_links();

DROP TRIGGER IF EXISTS crm_activity_validate_links ON public.crm_activity;
CREATE TRIGGER crm_activity_validate_links
  BEFORE INSERT ON public.crm_activity
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_crm_record_links();

-- Prevent normal updates/deletes on activity (append-only at DB layer).
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

  IF public.is_approved_crm_admin() THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'CRM activity is immutable and cannot be updated or deleted'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS crm_activity_prevent_update ON public.crm_activity;
CREATE TRIGGER crm_activity_prevent_update
  BEFORE UPDATE ON public.crm_activity
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_crm_activity_mutation();

DROP TRIGGER IF EXISTS crm_activity_prevent_delete ON public.crm_activity;
CREATE TRIGGER crm_activity_prevent_delete
  BEFORE DELETE ON public.crm_activity
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_crm_activity_mutation();

-- ---------------------------------------------------------------------------
-- 4. Access helpers (RLS)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_access_crm_task(target_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_approved_crm_admin()
    OR EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = target_task_id
        AND (
          t.assigned_to = auth.uid()
          OR t.created_by = auth.uid()
          OR (
            t.opportunity_id IS NOT NULL
            AND public.can_access_opportunity(t.opportunity_id)
          )
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_access_crm_links(
  p_company_id uuid,
  p_contact_id uuid,
  p_opportunity_id uuid,
  p_quote_id uuid,
  p_task_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_approved_crm_admin()
    OR (
      public.is_approved_crm_staff()
      AND (
        (p_company_id IS NOT NULL)
        OR (p_contact_id IS NOT NULL)
        OR (
          p_opportunity_id IS NOT NULL
          AND public.can_access_opportunity(p_opportunity_id)
        )
        OR (p_quote_id IS NOT NULL)
        OR (
          p_task_id IS NOT NULL
          AND public.can_access_crm_task(p_task_id)
        )
      )
    );
$$;

COMMENT ON FUNCTION public.can_access_crm_links IS
  'Sales: company/contact/quote-level activity is visible to all approved CRM staff; '
  'opportunity and task links require existing opportunity/task access rules.';

CREATE OR REPLACE FUNCTION public.can_edit_crm_note(
  note_created_by uuid,
  note_company_id uuid,
  note_contact_id uuid,
  note_opportunity_id uuid,
  note_quote_id uuid,
  note_task_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_approved_crm_admin()
    OR (
      note_created_by = auth.uid()
      AND public.can_access_crm_links(
        note_company_id,
        note_contact_id,
        note_opportunity_id,
        note_quote_id,
        note_task_id
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_soft_delete_crm_note(
  note_created_by uuid,
  note_company_id uuid,
  note_contact_id uuid,
  note_opportunity_id uuid,
  note_quote_id uuid,
  note_task_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_edit_crm_note(
    note_created_by,
    note_company_id,
    note_contact_id,
    note_opportunity_id,
    note_quote_id,
    note_task_id
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.crm_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activity ENABLE ROW LEVEL SECURITY;

-- crm_notes
CREATE POLICY "CRM admins full access to crm notes"
  ON public.crm_notes
  FOR ALL
  TO authenticated
  USING (public.is_approved_crm_admin())
  WITH CHECK (public.is_approved_crm_admin());

CREATE POLICY "CRM sales read accessible crm notes"
  ON public.crm_notes
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND public.is_approved_crm_staff()
    AND public.can_access_crm_links(
      company_id,
      contact_id,
      opportunity_id,
      quote_id,
      task_id
    )
  );

CREATE POLICY "CRM sales insert crm notes"
  ON public.crm_notes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_approved_crm_staff()
    AND created_by = auth.uid()
    AND deleted_at IS NULL
    AND public.can_access_crm_links(
      company_id,
      contact_id,
      opportunity_id,
      quote_id,
      task_id
    )
  );

CREATE POLICY "CRM sales update own accessible crm notes"
  ON public.crm_notes
  FOR UPDATE
  TO authenticated
  USING (
    public.can_edit_crm_note(
      created_by,
      company_id,
      contact_id,
      opportunity_id,
      quote_id,
      task_id
    )
  )
  WITH CHECK (
    public.can_edit_crm_note(
      created_by,
      company_id,
      contact_id,
      opportunity_id,
      quote_id,
      task_id
    )
  );

-- Hard DELETE restricted to admins (prefer soft delete via deleted_at).
CREATE POLICY "CRM admins hard delete crm notes"
  ON public.crm_notes
  FOR DELETE
  TO authenticated
  USING (public.is_approved_crm_admin());

-- crm_activity
CREATE POLICY "CRM admins full access to crm activity"
  ON public.crm_activity
  FOR ALL
  TO authenticated
  USING (public.is_approved_crm_admin())
  WITH CHECK (public.is_approved_crm_admin());

CREATE POLICY "CRM sales read accessible crm activity"
  ON public.crm_activity
  FOR SELECT
  TO authenticated
  USING (
    public.is_approved_crm_staff()
    AND public.can_access_crm_links(
      company_id,
      contact_id,
      opportunity_id,
      quote_id,
      task_id
    )
  );

CREATE POLICY "CRM sales insert crm activity"
  ON public.crm_activity
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_approved_crm_staff()
    AND public.can_access_crm_links(
      company_id,
      contact_id,
      opportunity_id,
      quote_id,
      task_id
    )
  );

-- production / accounts / customer: no policies → no access

COMMIT;

-- ---------------------------------------------------------------------------
-- 6. Backfill (run manually AFTER migration + app deploy)
-- DO NOT run automatically.
-- ---------------------------------------------------------------------------
--
-- BEGIN;
--
-- INSERT INTO public.crm_notes (
--   body,
--   company_id,
--   opportunity_id,
--   created_by,
--   is_pinned,
--   source_opportunity_note_id,
--   created_at,
--   updated_at
-- )
-- SELECT
--   n.body,
--   o.company_id,
--   n.opportunity_id,
--   n.created_by,
--   false,
--   n.id,
--   n.created_at,
--   n.updated_at
-- FROM public.opportunity_notes n
-- JOIN public.opportunities o ON o.id = n.opportunity_id
-- WHERE NOT EXISTS (
--   SELECT 1
--   FROM public.crm_notes cn
--   WHERE cn.source_opportunity_note_id = n.id
-- );
--
-- INSERT INTO public.crm_activity (
--   activity_type,
--   description,
--   metadata,
--   company_id,
--   opportunity_id,
--   actor_profile_id,
--   source_opportunity_activity_id,
--   created_at
-- )
-- SELECT
--   a.activity_type,
--   a.description,
--   a.metadata,
--   o.company_id,
--   a.opportunity_id,
--   a.created_by,
--   a.id,
--   a.created_at
-- FROM public.opportunity_activity a
-- JOIN public.opportunities o ON o.id = a.opportunity_id
-- WHERE NOT EXISTS (
--   SELECT 1
--   FROM public.crm_activity ca
--   WHERE ca.source_opportunity_activity_id = a.id
-- );
--
-- COMMIT;
--
-- ---------------------------------------------------------------------------
-- Post-apply verification (run manually)
-- ---------------------------------------------------------------------------
--
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name IN ('crm_notes', 'crm_activity')
-- ORDER BY table_name, ordinal_position;
--
-- SELECT tablename, policyname, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('crm_notes', 'crm_activity')
-- ORDER BY tablename, policyname;
