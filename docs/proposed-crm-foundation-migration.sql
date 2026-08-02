-- Proposed migration: Candid OS CRM foundation (Opportunities + Tasks)
-- Review and apply manually in Supabase. Do not run automatically from the app.
--
-- Replaces Capsule CRM sales layer above existing companies, quote_requests and quotes.
-- Does not duplicate company or quote totals on opportunities.
--
-- Prerequisites:
--   - public.is_candid_admin() already exists (approved super_admin + admin)
--   - Existing quote/customer RLS remains unchanged; this migration adds new tables only

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Enum types
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  CREATE TYPE public.opportunity_stage AS ENUM (
    'new_enquiry',
    'qualifying',
    'quote_in_progress',
    'quote_sent',
    'follow_up',
    'won',
    'lost'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.opportunity_source AS ENUM (
    'customer_portal',
    'admin',
    'phone',
    'email',
    'referral',
    'walk_in',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.task_status AS ENUM (
    'open',
    'in_progress',
    'completed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.task_priority AS ENUM (
    'low',
    'normal',
    'high',
    'urgent'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Helper functions (no dependency on opportunities tables)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_approved_crm_staff()
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
      AND p.user_role IN ('super_admin', 'admin', 'sales')
  );
$$;

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

CREATE OR REPLACE FUNCTION public.is_assignable_crm_staff(target_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = target_profile_id
      AND p.account_status = 'approved'
      AND p.user_role IN ('super_admin', 'admin', 'sales')
  );
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_crm_staff_profile_id(target_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT public.is_assignable_crm_staff(target_profile_id) THEN
    RAISE EXCEPTION 'Profile % is not approved CRM staff', target_profile_id
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. opportunities
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.opportunities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  title               text NOT NULL,
  description         text,
  estimated_value     numeric(12,2),
  currency            text NOT NULL DEFAULT 'GBP',
  stage               public.opportunity_stage NOT NULL DEFAULT 'new_enquiry',
  owner_profile_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  expected_close_date date,
  next_follow_up_at   timestamptz,
  source              public.opportunity_source NOT NULL DEFAULT 'admin',
  lost_reason         text,
  won_at              timestamptz,
  lost_at             timestamptz,
  created_by          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT opportunities_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT opportunities_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT opportunities_estimated_value_check
    CHECK (estimated_value IS NULL OR estimated_value >= 0),
  CONSTRAINT opportunities_lost_reason_required
    CHECK (stage <> 'lost' OR (lost_reason IS NOT NULL AND btrim(lost_reason) <> '')),
  CONSTRAINT opportunities_won_timestamp
    CHECK (stage <> 'won' OR won_at IS NOT NULL),
  CONSTRAINT opportunities_lost_timestamp
    CHECK (stage <> 'lost' OR lost_at IS NOT NULL),
  CONSTRAINT opportunities_terminal_timestamps
    CHECK (
      (stage = 'won' AND won_at IS NOT NULL AND lost_at IS NULL)
      OR (stage = 'lost' AND lost_at IS NOT NULL AND won_at IS NULL)
      OR (stage NOT IN ('won', 'lost') AND won_at IS NULL AND lost_at IS NULL)
    )
);

COMMENT ON TABLE public.opportunities IS
  'Master sales record linking companies, quote requests and quotes.';
COMMENT ON COLUMN public.opportunities.estimated_value IS
  'Pre-quote sales estimate. Quoted totals remain on quote_versions only.';

CREATE INDEX IF NOT EXISTS opportunities_company_id_idx
  ON public.opportunities (company_id);
CREATE INDEX IF NOT EXISTS opportunities_owner_profile_id_idx
  ON public.opportunities (owner_profile_id);
CREATE INDEX IF NOT EXISTS opportunities_stage_idx
  ON public.opportunities (stage);
CREATE INDEX IF NOT EXISTS opportunities_next_follow_up_at_idx
  ON public.opportunities (next_follow_up_at)
  WHERE next_follow_up_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS opportunities_created_at_idx
  ON public.opportunities (created_at DESC);
CREATE INDEX IF NOT EXISTS opportunities_active_pipeline_idx
  ON public.opportunities (stage, updated_at DESC)
  WHERE stage NOT IN ('won', 'lost');

-- ---------------------------------------------------------------------------
-- 4. opportunity_members
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.opportunity_members (
  opportunity_id  uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (opportunity_id, profile_id)
);

COMMENT ON TABLE public.opportunity_members IS
  'Collaborators on an opportunity. Primary owner is opportunities.owner_profile_id.';

CREATE INDEX IF NOT EXISTS opportunity_members_profile_id_idx
  ON public.opportunity_members (profile_id);

-- ---------------------------------------------------------------------------
-- 5. Triggers on opportunities and opportunity_members
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_opportunity_staff_assignments()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.validate_crm_staff_profile_id(NEW.owner_profile_id);
  PERFORM public.validate_crm_staff_profile_id(NEW.created_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunities_set_updated_at ON public.opportunities;
CREATE TRIGGER opportunities_set_updated_at
  BEFORE UPDATE ON public.opportunities
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS opportunities_validate_staff_assignments ON public.opportunities;
CREATE TRIGGER opportunities_validate_staff_assignments
  BEFORE INSERT OR UPDATE OF owner_profile_id, created_by ON public.opportunities
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_opportunity_staff_assignments();

CREATE OR REPLACE FUNCTION public.validate_opportunity_member_profile()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.validate_crm_staff_profile_id(NEW.profile_id);

  IF EXISTS (
    SELECT 1
    FROM public.opportunities o
    WHERE o.id = NEW.opportunity_id
      AND o.owner_profile_id = NEW.profile_id
  ) THEN
    RAISE EXCEPTION 'Opportunity owner should not also be listed as a collaborator'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_members_validate_profile ON public.opportunity_members;
CREATE TRIGGER opportunity_members_validate_profile
  BEFORE INSERT OR UPDATE ON public.opportunity_members
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_opportunity_member_profile();

-- ---------------------------------------------------------------------------
-- 6. can_access_opportunity (depends on opportunities + opportunity_members)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_access_opportunity(target_opportunity_id uuid)
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
      FROM public.opportunities o
      WHERE o.id = target_opportunity_id
        AND (
          o.owner_profile_id = auth.uid()
          OR o.created_by = auth.uid()
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.opportunity_members om
      WHERE om.opportunity_id = target_opportunity_id
        AND om.profile_id = auth.uid()
    );
$$;

-- ---------------------------------------------------------------------------
-- 7. tasks
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  description     text,
  assigned_to     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_by      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  due_at          timestamptz,
  completed_at    timestamptz,
  status          public.task_status NOT NULL DEFAULT 'open',
  priority        public.task_priority NOT NULL DEFAULT 'normal',
  opportunity_id  uuid REFERENCES public.opportunities(id) ON DELETE SET NULL,
  quote_id        uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  company_id      uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tasks_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT tasks_completed_at_consistency
    CHECK (
      (status = 'completed' AND completed_at IS NOT NULL)
      OR (status <> 'completed' AND completed_at IS NULL)
    ),
  CONSTRAINT tasks_quote_requires_opportunity
    CHECK (quote_id IS NULL OR opportunity_id IS NOT NULL)
);

COMMENT ON TABLE public.tasks IS
  'CRM tasks linked to opportunities, quotes and optionally companies.';
COMMENT ON COLUMN public.tasks.company_id IS
  'Optional denormalised company for company-level tasks. Must match linked opportunity company when both are set.';

CREATE INDEX IF NOT EXISTS tasks_assigned_to_status_due_idx
  ON public.tasks (assigned_to, status, due_at);
CREATE INDEX IF NOT EXISTS tasks_opportunity_id_idx
  ON public.tasks (opportunity_id)
  WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_quote_id_idx
  ON public.tasks (quote_id)
  WHERE quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_company_id_idx
  ON public.tasks (company_id)
  WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_open_due_idx
  ON public.tasks (due_at)
  WHERE status IN ('open', 'in_progress');

DROP TRIGGER IF EXISTS tasks_set_updated_at ON public.tasks;
CREATE TRIGGER tasks_set_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.validate_task_relationships()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  opportunity_company_id uuid;
  quote_opportunity_id uuid;
BEGIN
  PERFORM public.validate_crm_staff_profile_id(NEW.assigned_to);
  PERFORM public.validate_crm_staff_profile_id(NEW.created_by);

  IF NEW.opportunity_id IS NOT NULL AND NEW.company_id IS NOT NULL THEN
    SELECT o.company_id
    INTO opportunity_company_id
    FROM public.opportunities o
    WHERE o.id = NEW.opportunity_id;

    IF opportunity_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'Task company_id must match linked opportunity company'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.quote_id IS NOT NULL THEN
    SELECT q.opportunity_id
    INTO quote_opportunity_id
    FROM public.quotes q
    WHERE q.id = NEW.quote_id;

    IF quote_opportunity_id IS NULL THEN
      RAISE EXCEPTION 'Linked quote must have opportunity_id set before task linkage'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.opportunity_id IS DISTINCT FROM quote_opportunity_id THEN
      RAISE EXCEPTION 'Task opportunity_id must match linked quote opportunity_id'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_validate_relationships ON public.tasks;
CREATE TRIGGER tasks_validate_relationships
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_task_relationships();

-- ---------------------------------------------------------------------------
-- 8. opportunity_notes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.opportunity_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id  uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  body            text NOT NULL,
  created_by      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT opportunity_notes_body_not_blank CHECK (btrim(body) <> '')
);

CREATE INDEX IF NOT EXISTS opportunity_notes_opportunity_created_idx
  ON public.opportunity_notes (opportunity_id, created_at DESC);

DROP TRIGGER IF EXISTS opportunity_notes_set_updated_at ON public.opportunity_notes;
CREATE TRIGGER opportunity_notes_set_updated_at
  BEFORE UPDATE ON public.opportunity_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 9. opportunity_activity
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.opportunity_activity (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id  uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  activity_type   text NOT NULL,
  description     text NOT NULL,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT opportunity_activity_type_not_blank CHECK (btrim(activity_type) <> ''),
  CONSTRAINT opportunity_activity_description_not_blank CHECK (btrim(description) <> '')
);

CREATE INDEX IF NOT EXISTS opportunity_activity_opportunity_created_idx
  ON public.opportunity_activity (opportunity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS opportunity_activity_type_idx
  ON public.opportunity_activity (activity_type);

-- ---------------------------------------------------------------------------
-- 10. Link existing quotation tables
-- ---------------------------------------------------------------------------

ALTER TABLE public.quote_requests
  ADD COLUMN IF NOT EXISTS opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE SET NULL;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS quote_requests_opportunity_id_idx
  ON public.quote_requests (opportunity_id);
CREATE INDEX IF NOT EXISTS quotes_opportunity_id_idx
  ON public.quotes (opportunity_id);

CREATE OR REPLACE FUNCTION public.validate_quote_opportunity_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  request_opportunity_id uuid;
BEGIN
  IF NEW.quote_request_id IS NULL OR NEW.opportunity_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT qr.opportunity_id
  INTO request_opportunity_id
  FROM public.quote_requests qr
  WHERE qr.id = NEW.quote_request_id;

  IF request_opportunity_id IS NOT NULL
     AND request_opportunity_id IS DISTINCT FROM NEW.opportunity_id THEN
    RAISE EXCEPTION 'Quote opportunity_id must match linked quote_request opportunity_id'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotes_validate_opportunity_link ON public.quotes;
CREATE TRIGGER quotes_validate_opportunity_link
  BEFORE INSERT OR UPDATE OF opportunity_id, quote_request_id ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_quote_opportunity_link();

-- ---------------------------------------------------------------------------
-- 11. Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_activity ENABLE ROW LEVEL SECURITY;

-- opportunities
CREATE POLICY "CRM admins full access to opportunities"
  ON public.opportunities
  FOR ALL
  TO authenticated
  USING (public.is_approved_crm_admin())
  WITH CHECK (public.is_approved_crm_admin());

CREATE POLICY "CRM sales read accessible opportunities"
  ON public.opportunities
  FOR SELECT
  TO authenticated
  USING (public.is_approved_crm_staff() AND public.can_access_opportunity(id));

CREATE POLICY "CRM sales insert opportunities"
  ON public.opportunities
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_approved_crm_staff());

CREATE POLICY "CRM sales update accessible opportunities"
  ON public.opportunities
  FOR UPDATE
  TO authenticated
  USING (public.is_approved_crm_staff() AND public.can_access_opportunity(id))
  WITH CHECK (public.is_approved_crm_staff() AND public.can_access_opportunity(id));

-- opportunity_members
CREATE POLICY "CRM admins full access to opportunity members"
  ON public.opportunity_members
  FOR ALL
  TO authenticated
  USING (public.is_approved_crm_admin())
  WITH CHECK (public.is_approved_crm_admin());

CREATE POLICY "CRM sales manage members on accessible opportunities"
  ON public.opportunity_members
  FOR ALL
  TO authenticated
  USING (
    public.is_approved_crm_staff()
    AND public.can_access_opportunity(opportunity_id)
  )
  WITH CHECK (
    public.is_approved_crm_staff()
    AND public.can_access_opportunity(opportunity_id)
  );

-- tasks
CREATE POLICY "CRM admins full access to tasks"
  ON public.tasks
  FOR ALL
  TO authenticated
  USING (public.is_approved_crm_admin())
  WITH CHECK (public.is_approved_crm_admin());

CREATE POLICY "CRM sales read related tasks"
  ON public.tasks
  FOR SELECT
  TO authenticated
  USING (
    public.is_approved_crm_staff()
    AND (
      assigned_to = auth.uid()
      OR created_by = auth.uid()
      OR (
        opportunity_id IS NOT NULL
        AND public.can_access_opportunity(opportunity_id)
      )
    )
  );

CREATE POLICY "CRM sales insert tasks"
  ON public.tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_approved_crm_staff());

CREATE POLICY "CRM sales update related tasks"
  ON public.tasks
  FOR UPDATE
  TO authenticated
  USING (
    public.is_approved_crm_staff()
    AND (
      assigned_to = auth.uid()
      OR created_by = auth.uid()
      OR (
        opportunity_id IS NOT NULL
        AND public.can_access_opportunity(opportunity_id)
      )
    )
  )
  WITH CHECK (public.is_approved_crm_staff());

-- opportunity_notes
CREATE POLICY "CRM admins full access to opportunity notes"
  ON public.opportunity_notes
  FOR ALL
  TO authenticated
  USING (public.is_approved_crm_admin())
  WITH CHECK (public.is_approved_crm_admin());

CREATE POLICY "CRM sales manage notes on accessible opportunities"
  ON public.opportunity_notes
  FOR ALL
  TO authenticated
  USING (
    public.is_approved_crm_staff()
    AND public.can_access_opportunity(opportunity_id)
  )
  WITH CHECK (
    public.is_approved_crm_staff()
    AND public.can_access_opportunity(opportunity_id)
  );

-- opportunity_activity (append-only for sales; admins manage)
CREATE POLICY "CRM admins full access to opportunity activity"
  ON public.opportunity_activity
  FOR ALL
  TO authenticated
  USING (public.is_approved_crm_admin())
  WITH CHECK (public.is_approved_crm_admin());

CREATE POLICY "CRM sales read activity on accessible opportunities"
  ON public.opportunity_activity
  FOR SELECT
  TO authenticated
  USING (
    public.is_approved_crm_staff()
    AND public.can_access_opportunity(opportunity_id)
  );

CREATE POLICY "CRM sales insert activity on accessible opportunities"
  ON public.opportunity_activity
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_approved_crm_staff()
    AND public.can_access_opportunity(opportunity_id)
  );

COMMIT;

-- Notes:
-- 1. production and accounts staff have no CRM policies and therefore no access.
-- 2. Customers have no CRM policies and therefore no access.
-- 3. Existing quote_requests and quotes RLS policies are unchanged by this file.
-- 4. Apply docs/crm-implementation-plan.md backfill after this migration in staging.
