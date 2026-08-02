-- Preserve crm_activity when quotes are permanently deleted
-- Review and apply manually in Supabase.
-- DO NOT run automatically.
--
-- Problem:
--   crm_activity.quote_id currently uses ON DELETE CASCADE.
--   Deleting a quote attempts to DELETE related activity rows, but
--   prevent_crm_activity_mutation blocks non-admin deletes (and audit rows
--   must be retained anyway).
--
-- Fix:
--   1. Change quote_id FK to ON DELETE SET NULL
--   2. Allow FK-driven quote_id nullification through the immutability trigger
--
-- Verify before apply:
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public.crm_activity'::regclass
--     AND contype = 'f'
--   ORDER BY conname;

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. quote_id: CASCADE → SET NULL (required)
-- ---------------------------------------------------------------------------

ALTER TABLE public.crm_activity
  DROP CONSTRAINT IF EXISTS crm_activity_quote_id_fkey;

ALTER TABLE public.crm_activity
  ADD CONSTRAINT crm_activity_quote_id_fkey
  FOREIGN KEY (quote_id)
  REFERENCES public.quotes(id)
  ON DELETE SET NULL;

COMMENT ON CONSTRAINT crm_activity_quote_id_fkey ON public.crm_activity IS
  'Preserve activity when quotes are deleted; quote_id is cleared, metadata keeps context.';

-- ---------------------------------------------------------------------------
-- 2. Immutability trigger: permit FK-driven quote_id SET NULL (required)
-- ---------------------------------------------------------------------------
-- ON DELETE SET NULL issues UPDATE on crm_activity. The existing immutability
-- trigger must allow quote_id-only nullification or quote deletion still fails.

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

COMMIT;

-- ---------------------------------------------------------------------------
-- 3. Other crm_activity foreign keys (recommendations only — not changed here)
-- ---------------------------------------------------------------------------
--
-- | Column          | Current (proposed migration) | Recommendation |
-- |-----------------|------------------------------|----------------|
-- | contact_id      | ON DELETE SET NULL           | Keep SET NULL  |
-- | actor_profile_id| ON DELETE SET NULL           | Keep SET NULL  |
-- | company_id      | ON DELETE CASCADE            | Consider SET NULL to preserve audit trail when a company is removed; ensure at_least_one_link still satisfied via other FKs |
-- | opportunity_id  | ON DELETE CASCADE            | Consider SET NULL — opportunity deletion should not erase sales history |
-- | task_id         | ON DELETE CASCADE            | Consider SET NULL — completed task activity should remain visible |
-- | quote_id        | (this migration) SET NULL    | Applied        |
--
-- crm_activity_at_least_one_link requires at least one of:
--   company_id, contact_id, opportunity_id, quote_id, task_id
-- When moving other FKs to SET NULL, retain denormalised company_id on insert
-- so rows remain valid after child record deletion.
