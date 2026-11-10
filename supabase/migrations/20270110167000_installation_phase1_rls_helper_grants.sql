-- Installation Phase 1 — EXECUTE on SECURITY DEFINER helpers used inside RLS policies.
-- 163000 REVOKEd these from authenticated; RLS USING/WITH CHECK still invokes them as the
-- querying role, so EXECUTE is required. No table writes; helpers only read profiles / paths.
-- Apply on Test after 166000. SQL Editor safe.

BEGIN;

GRANT EXECUTE ON FUNCTION public.is_approved_installation_reader() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_approved_installation_operator() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_approved_installation_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.storage_installation_visit_id_from_path(text) TO authenticated;

COMMIT;
