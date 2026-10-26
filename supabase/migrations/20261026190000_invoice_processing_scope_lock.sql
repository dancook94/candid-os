-- Stop a sealed processing run from being rewritten after it is created.
-- Application roles may update a run, but the eligible count stays at the value
-- recorded when the run started. Scope rows are inserted once. A direct update
-- or delete cannot replace an invoice while that run still exists.
-- Deleting the run itself may still remove its scope rows.
-- This does not scan Gmail or change the materials catalogue.
-- Apply manually in Supabase after 20261026180000. Do not edit that migration.

BEGIN;

CREATE OR REPLACE FUNCTION public.invoice_processing_reject_eligible_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.eligible_at_start IS DISTINCT FROM OLD.eligible_at_start THEN
    RAISE EXCEPTION 'The invoice processing eligible count cannot be changed.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoice_processing_runs_reject_eligible_change ON public.invoice_processing_runs;
CREATE TRIGGER invoice_processing_runs_reject_eligible_change
  BEFORE UPDATE ON public.invoice_processing_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.invoice_processing_reject_eligible_change();

CREATE OR REPLACE FUNCTION public.invoice_processing_reject_scope_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1
    FROM public.invoice_processing_runs
    WHERE id = OLD.run_id
  ) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'The invoice processing scope cannot be changed.';
END;
$$;

DROP TRIGGER IF EXISTS invoice_processing_scope_immutable ON public.invoice_processing_scope;
CREATE TRIGGER invoice_processing_scope_immutable
  BEFORE UPDATE OR DELETE ON public.invoice_processing_scope
  FOR EACH ROW
  EXECUTE FUNCTION public.invoice_processing_reject_scope_change();

REVOKE ALL ON FUNCTION public.invoice_processing_reject_eligible_change() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invoice_processing_reject_scope_change() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_processing_reject_eligible_change() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_processing_reject_scope_change() TO authenticated, service_role;

REVOKE UPDATE, DELETE ON TABLE public.invoice_processing_scope FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
