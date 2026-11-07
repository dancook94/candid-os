-- Grant quote_repeat_requests to roles that call repeat_quote() (SECURITY INVOKER).
-- Row access still requires is_approved_candid_admin() via RLS on the table.
-- Does not grant anon, PUBLIC, or DELETE. Test release only until promoted.

BEGIN;

REVOKE ALL ON TABLE public.quote_repeat_requests FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON TABLE public.quote_repeat_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.quote_repeat_requests TO service_role;

COMMIT;
