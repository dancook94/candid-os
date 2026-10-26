-- Grant the invoice-processing tables to the two roles that use them.
-- Signed-in administrators use authenticated. The scheduled worker uses service_role.
-- Row access for administrators still requires is_approved_candid_admin().
-- The claim function remains SECURITY DEFINER and rejects every other caller.
-- Primary keys use gen_random_uuid(), so no sequence grant is required.
-- This does not grant anon or PUBLIC, and it does not change invoices or the materials catalogue.
-- Apply manually in Supabase. Do not run automatically from the app.

BEGIN;

REVOKE ALL ON TABLE public.invoice_processing_runs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.invoice_processing_attempts FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.invoice_processing_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.invoice_processing_attempts TO authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.invoice_processing_runs TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.invoice_processing_attempts TO service_role;

DROP POLICY IF EXISTS invoice_processing_runs_admin ON public.invoice_processing_runs;
CREATE POLICY invoice_processing_runs_admin
  ON public.invoice_processing_runs
  FOR ALL
  TO authenticated
  USING (public.is_approved_candid_admin())
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS invoice_processing_attempts_admin ON public.invoice_processing_attempts;
CREATE POLICY invoice_processing_attempts_admin
  ON public.invoice_processing_attempts
  FOR ALL
  TO authenticated
  USING (public.is_approved_candid_admin())
  WITH CHECK (public.is_approved_candid_admin());

REVOKE ALL ON FUNCTION public.claim_invoice_processing_run(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_invoice_processing_run(uuid, integer) TO authenticated, service_role;

COMMIT;
