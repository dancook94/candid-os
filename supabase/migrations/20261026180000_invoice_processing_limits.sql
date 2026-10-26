-- Fix the invoices a background run may process when it starts.
-- Later ticks, including the scheduled worker, may only attempt that list.
-- Failures, duplicates and skips use a place on the list and are not replaced.
-- The chosen maximum cannot be raised later.
-- This does not scan Gmail or change the materials catalogue.
-- Apply manually in Supabase. Do not run automatically from the app.

BEGIN;

ALTER TABLE public.invoice_processing_runs
  ADD COLUMN IF NOT EXISTS invoice_limit integer,
  ADD COLUMN IF NOT EXISTS eligible_at_start integer,
  ADD COLUMN IF NOT EXISTS completion_reason text,
  ADD COLUMN IF NOT EXISTS scope_sealed boolean NOT NULL DEFAULT false;

ALTER TABLE public.invoice_processing_runs
  DROP CONSTRAINT IF EXISTS invoice_processing_runs_completion_reason_check;

ALTER TABLE public.invoice_processing_runs
  ADD CONSTRAINT invoice_processing_runs_completion_reason_check
  CHECK (
    completion_reason IS NULL
    OR completion_reason IN ('limit_reached', 'queue_exhausted')
  );

CREATE TABLE IF NOT EXISTS public.invoice_processing_scope (
  run_id uuid NOT NULL REFERENCES public.invoice_processing_runs (id) ON DELETE CASCADE,
  gmail_import_item_id uuid NOT NULL REFERENCES public.gmail_import_items (id) ON DELETE RESTRICT,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, gmail_import_item_id),
  CONSTRAINT invoice_processing_scope_position_positive CHECK (position > 0),
  CONSTRAINT invoice_processing_scope_position_unique UNIQUE (run_id, position)
);

-- Drop guards before backfill so a repeated run is not rejected by the seal.
DROP TRIGGER IF EXISTS invoice_processing_runs_reject_limit_change ON public.invoice_processing_runs;
DROP TRIGGER IF EXISTS invoice_processing_scope_guard ON public.invoice_processing_scope;
DROP TRIGGER IF EXISTS invoice_processing_attempts_guard ON public.invoice_processing_attempts;

INSERT INTO public.invoice_processing_scope (run_id, gmail_import_item_id, position)
SELECT attempt.run_id,
       attempt.gmail_import_item_id,
       row_number() OVER (PARTITION BY attempt.run_id ORDER BY attempt.created_at, attempt.gmail_import_item_id)
FROM public.invoice_processing_attempts AS attempt
ON CONFLICT (run_id, gmail_import_item_id) DO NOTHING;

-- Count with a join. A nested count aliased with AS is rejected by the Test parser.
UPDATE public.invoice_processing_runs AS run
SET invoice_limit = GREATEST(scope.authorised, 1),
    eligible_at_start = scope.authorised,
    scope_sealed = true
FROM (
  SELECT runs.id,
         count(item.gmail_import_item_id)::integer AS authorised
  FROM public.invoice_processing_runs AS runs
  LEFT JOIN public.invoice_processing_scope AS item
    ON item.run_id = runs.id
  GROUP BY runs.id
) AS scope
WHERE run.id = scope.id
  AND run.invoice_limit IS NULL;

ALTER TABLE public.invoice_processing_runs
  ALTER COLUMN invoice_limit SET NOT NULL,
  ALTER COLUMN eligible_at_start SET NOT NULL;

ALTER TABLE public.invoice_processing_runs
  DROP CONSTRAINT IF EXISTS invoice_processing_runs_invoice_limit_check;

ALTER TABLE public.invoice_processing_runs
  ADD CONSTRAINT invoice_processing_runs_invoice_limit_check
  CHECK (invoice_limit >= 1 AND eligible_at_start >= 0);

CREATE OR REPLACE FUNCTION public.invoice_processing_reject_limit_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.invoice_limit IS DISTINCT FROM OLD.invoice_limit THEN
    RAISE EXCEPTION 'The invoice processing maximum cannot be changed.';
  END IF;

  IF OLD.scope_sealed AND NOT NEW.scope_sealed THEN
    RAISE EXCEPTION 'The invoice processing scope cannot be reopened.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoice_processing_runs_reject_limit_change ON public.invoice_processing_runs;
CREATE TRIGGER invoice_processing_runs_reject_limit_change
  BEFORE UPDATE ON public.invoice_processing_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.invoice_processing_reject_limit_change();

CREATE OR REPLACE FUNCTION public.invoice_processing_guard_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  authorised_limit integer;
  sealed boolean;
BEGIN
  SELECT invoice_limit, scope_sealed
  INTO authorised_limit, sealed
  FROM public.invoice_processing_runs
  WHERE id = NEW.run_id
  FOR UPDATE;

  IF authorised_limit IS NULL THEN
    RAISE EXCEPTION 'This processing run could not be found.';
  END IF;

  IF sealed THEN
    RAISE EXCEPTION 'The invoice processing scope is already fixed.';
  END IF;

  IF (
    SELECT count(*)
    FROM public.invoice_processing_scope
    WHERE run_id = NEW.run_id
  ) >= authorised_limit THEN
    RAISE EXCEPTION 'The invoice processing maximum has been reached.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoice_processing_scope_guard ON public.invoice_processing_scope;
CREATE TRIGGER invoice_processing_scope_guard
  BEFORE INSERT ON public.invoice_processing_scope
  FOR EACH ROW
  EXECUTE FUNCTION public.invoice_processing_guard_scope();

CREATE OR REPLACE FUNCTION public.invoice_processing_guard_attempt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  authorised integer;
BEGIN
  PERFORM 1
  FROM public.invoice_processing_runs
  WHERE id = NEW.run_id
  FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1
    FROM public.invoice_processing_scope
    WHERE run_id = NEW.run_id
      AND gmail_import_item_id = NEW.gmail_import_item_id
  ) THEN
    RAISE EXCEPTION 'This invoice is outside the processing run.';
  END IF;

  SELECT count(*)
  INTO authorised
  FROM public.invoice_processing_scope
  WHERE run_id = NEW.run_id;

  IF (
    SELECT count(*)
    FROM public.invoice_processing_attempts
    WHERE run_id = NEW.run_id
  ) >= authorised THEN
    RAISE EXCEPTION 'This run has used its invoice allowance.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoice_processing_attempts_guard ON public.invoice_processing_attempts;
CREATE TRIGGER invoice_processing_attempts_guard
  BEFORE INSERT ON public.invoice_processing_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.invoice_processing_guard_attempt();

ALTER TABLE public.invoice_processing_scope ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_processing_scope_admin ON public.invoice_processing_scope;
CREATE POLICY invoice_processing_scope_admin
  ON public.invoice_processing_scope
  FOR ALL
  TO authenticated
  USING (public.is_approved_candid_admin())
  WITH CHECK (public.is_approved_candid_admin());

REVOKE ALL ON TABLE public.invoice_processing_scope FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.invoice_processing_scope TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.invoice_processing_reject_limit_change() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invoice_processing_guard_scope() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invoice_processing_guard_attempt() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_processing_reject_limit_change() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_processing_guard_scope() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_processing_guard_attempt() TO authenticated, service_role;

COMMIT;
