-- Installation Phase 1 — SELECT grants for authenticated (Test).
-- RLS policies gate rows; table-level SELECT is required for PostgREST and
-- authenticated readers (sales/production/admin). No INSERT/UPDATE/DELETE grants.
-- Apply after 163000 (+ hardening repair). SQL Editor safe.

BEGIN;

GRANT SELECT ON TABLE public.installation_projects TO authenticated;
GRANT SELECT ON TABLE public.installation_visits TO authenticated;
GRANT SELECT ON TABLE public.installation_visit_assignments TO authenticated;
GRANT SELECT ON TABLE public.installation_visit_documents TO authenticated;
GRANT SELECT ON TABLE public.installation_visit_photos TO authenticated;
GRANT SELECT ON TABLE public.installation_snag_items TO authenticated;
GRANT SELECT ON TABLE public.installation_sign_offs TO authenticated;
GRANT SELECT ON TABLE public.installation_visit_events TO authenticated;

COMMIT;
