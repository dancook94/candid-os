-- Installation board reads through the service role after the app reader check.
-- Phase 1 granted SELECT to authenticated only, so service_role received
-- "permission denied for table installation_projects" even when the table was empty.
-- SELECT only. Direct writes stay blocked. Test only (axhkdwgmwhlbsstumndh).

BEGIN;

GRANT SELECT ON TABLE public.installation_projects TO service_role;
GRANT SELECT ON TABLE public.installation_visits TO service_role;
GRANT SELECT ON TABLE public.installation_visit_assignments TO service_role;
GRANT SELECT ON TABLE public.installation_visit_documents TO service_role;
GRANT SELECT ON TABLE public.installation_visit_photos TO service_role;
GRANT SELECT ON TABLE public.installation_snag_items TO service_role;
GRANT SELECT ON TABLE public.installation_sign_offs TO service_role;
GRANT SELECT ON TABLE public.installation_visit_events TO service_role;

COMMIT;
