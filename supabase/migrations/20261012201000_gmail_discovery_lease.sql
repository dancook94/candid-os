-- Adds an expiring lease so two discovery batches cannot process the same run.
-- The applied 20261012194500_gmail_discovery.sql migration is unchanged.
-- This does not create supplier invoices, materials, or prices.

BEGIN;

ALTER TABLE public.gmail_import_runs
  ADD COLUMN IF NOT EXISTS lease_until timestamptz;

CREATE OR REPLACE FUNCTION public.claim_gmail_discovery_run(
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
    RAISE EXCEPTION 'Discovery lease must be between 30 and 300 seconds.';
  END IF;

  UPDATE public.gmail_import_runs
  SET lease_until = now() + make_interval(secs => lease_seconds)
  WHERE id = target_id
    AND status = 'running'
    AND (lease_until IS NULL OR lease_until < now());

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_gmail_discovery_run(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_gmail_discovery_run(uuid, integer) TO service_role;

COMMIT;
