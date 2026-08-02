-- Add soft-delete columns to public.crm_notes (if missing)
-- Review and apply manually in Supabase.
-- DO NOT run automatically.
--
-- Background:
--   public.validate_crm_record_links() (trigger crm_notes_validate_links) contains:
--     IF TG_TABLE_NAME = 'crm_notes' AND NEW.deleted_at IS NOT NULL THEN ...
--   That raises "record \"new\" has no field \"deleted_at\"" when crm_notes lacks
--   deleted_at / deleted_by — e.g. if the table was created before those columns
--   were added, or CREATE TABLE IF NOT EXISTS skipped an older definition.
--
--   The application and RLS policies in docs/proposed-crm-notes-activity-migration.sql
--   also expect deleted_at / deleted_by for soft deletes.
--
-- Verify before apply:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'crm_notes'
--   ORDER BY ordinal_position;
--
--   SELECT tgname, pg_get_triggerdef(oid)
--   FROM pg_trigger
--   WHERE tgrelid = 'public.crm_notes'::regclass AND NOT tgisinternal;

BEGIN;

ALTER TABLE public.crm_notes
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.crm_notes.deleted_at IS
  'Soft delete timestamp. Deleted note body must not appear in activity metadata.';
COMMENT ON COLUMN public.crm_notes.deleted_by IS
  'Staff profile that soft-deleted this note.';

ALTER TABLE public.crm_notes
  DROP CONSTRAINT IF EXISTS crm_notes_deleted_by_consistency;

ALTER TABLE public.crm_notes
  ADD CONSTRAINT crm_notes_deleted_by_consistency CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL)
    OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL)
  );

-- Partial indexes (safe to recreate; match proposed-crm-notes-activity-migration.sql)
DROP INDEX IF EXISTS crm_notes_company_created_idx;
CREATE INDEX crm_notes_company_created_idx
  ON public.crm_notes (company_id, created_at DESC)
  WHERE company_id IS NOT NULL AND deleted_at IS NULL;

DROP INDEX IF EXISTS crm_notes_contact_created_idx;
CREATE INDEX crm_notes_contact_created_idx
  ON public.crm_notes (contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL AND deleted_at IS NULL;

DROP INDEX IF EXISTS crm_notes_opportunity_created_idx;
CREATE INDEX crm_notes_opportunity_created_idx
  ON public.crm_notes (opportunity_id, created_at DESC)
  WHERE opportunity_id IS NOT NULL AND deleted_at IS NULL;

DROP INDEX IF EXISTS crm_notes_quote_created_idx;
CREATE INDEX crm_notes_quote_created_idx
  ON public.crm_notes (quote_id, created_at DESC)
  WHERE quote_id IS NOT NULL AND deleted_at IS NULL;

DROP INDEX IF EXISTS crm_notes_task_created_idx;
CREATE INDEX crm_notes_task_created_idx
  ON public.crm_notes (task_id, created_at DESC)
  WHERE task_id IS NOT NULL AND deleted_at IS NULL;

DROP INDEX IF EXISTS crm_notes_pinned_created_idx;
CREATE INDEX crm_notes_pinned_created_idx
  ON public.crm_notes (is_pinned DESC, created_at DESC)
  WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS crm_notes_created_by_idx;
CREATE INDEX crm_notes_created_by_idx
  ON public.crm_notes (created_by, created_at DESC)
  WHERE deleted_at IS NULL;

COMMIT;

-- Post-apply: confirm columns exist and note insert succeeds.
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'crm_notes'
--   AND column_name IN ('deleted_at', 'deleted_by');
