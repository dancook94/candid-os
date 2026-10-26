-- Persist background processing of stored Gmail invoice PDFs.
-- This does not scan Gmail, enable ongoing synchronisation, or change
-- materials, supplier products, or material_prices.
-- Apply manually in Supabase. Do not run automatically from the app.

BEGIN;

CREATE TABLE IF NOT EXISTS public.invoice_processing_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL,
  batch_size integer NOT NULL DEFAULT 5,
  promoted_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  extraction_failure_count integer NOT NULL DEFAULT 0,
  last_error text,
  lease_until timestamptz,
  started_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_processing_runs_status_check CHECK (
    status IN ('running', 'paused', 'completed')
  ),
  CONSTRAINT invoice_processing_runs_batch_size_check CHECK (
    batch_size BETWEEN 1 AND 10
  ),
  CONSTRAINT invoice_processing_runs_counts_non_negative CHECK (
    promoted_count >= 0
    AND duplicate_count >= 0
    AND skipped_count >= 0
    AND failed_count >= 0
    AND extraction_failure_count >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS invoice_processing_runs_one_active_idx
  ON public.invoice_processing_runs ((true))
  WHERE status IN ('running', 'paused');

DROP TRIGGER IF EXISTS invoice_processing_runs_set_updated_at ON public.invoice_processing_runs;
CREATE TRIGGER invoice_processing_runs_set_updated_at
  BEFORE UPDATE ON public.invoice_processing_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

CREATE TABLE IF NOT EXISTS public.invoice_processing_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.invoice_processing_runs (id) ON DELETE CASCADE,
  gmail_import_item_id uuid NOT NULL REFERENCES public.gmail_import_items (id) ON DELETE RESTRICT,
  outcome text NOT NULL,
  supplier_invoice_id uuid REFERENCES public.supplier_invoices (id) ON DELETE SET NULL,
  extraction_failed boolean NOT NULL DEFAULT false,
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_processing_attempts_outcome_check CHECK (
    outcome IN ('promoted', 'duplicate', 'skipped', 'failed')
  ),
  CONSTRAINT invoice_processing_attempts_run_item_unique UNIQUE (run_id, gmail_import_item_id)
);

CREATE INDEX IF NOT EXISTS invoice_processing_attempts_run_idx
  ON public.invoice_processing_attempts (run_id, created_at DESC);

ALTER TABLE public.invoice_processing_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_processing_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_processing_runs_admin ON public.invoice_processing_runs;
CREATE POLICY invoice_processing_runs_admin
  ON public.invoice_processing_runs
  FOR ALL
  USING (public.is_approved_candid_admin())
  WITH CHECK (public.is_approved_candid_admin());

DROP POLICY IF EXISTS invoice_processing_attempts_admin ON public.invoice_processing_attempts;
CREATE POLICY invoice_processing_attempts_admin
  ON public.invoice_processing_attempts
  FOR ALL
  USING (public.is_approved_candid_admin())
  WITH CHECK (public.is_approved_candid_admin());

CREATE OR REPLACE FUNCTION public.claim_invoice_processing_run(
  target_id uuid,
  lease_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer;
BEGIN
  IF lease_seconds < 30 OR lease_seconds > 300 THEN
    RAISE EXCEPTION 'Invoice processing lease must be between 30 and 300 seconds.';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Not allowed.';
  END IF;

  UPDATE public.invoice_processing_runs
  SET lease_until = now() + make_interval(secs => lease_seconds)
  WHERE id = target_id
    AND status = 'running'
    AND (lease_until IS NULL OR lease_until < now());

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_invoice_processing_run(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_invoice_processing_run(uuid, integer) TO authenticated, service_role;

COMMIT;
