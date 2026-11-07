-- Test-only validation for confirm_existing_bulk_invoice_links (paste into Test Supabase SQL Editor).
-- Rolls back all changes. Do not run on Live.

BEGIN;

DO $$
DECLARE
  v_anon text;
  v_auth text;
BEGIN
  IF to_regprocedure('public.confirm_existing_bulk_invoice_links(uuid[],uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'confirm_existing_bulk_invoice_links is missing';
  END IF;

  IF to_regprocedure('public.invoice_existing_link_dimension_conflict(text,text,text,numeric,numeric,numeric,numeric)') IS NULL THEN
    RAISE EXCEPTION 'invoice_existing_link_dimension_conflict is missing';
  END IF;

  BEGIN
    PERFORM public.confirm_existing_bulk_invoice_links(ARRAY[]::uuid[], gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'expected empty selection to fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE 'Select the invoice lines to confirm%' THEN
        RAISE;
      END IF;
  END;

  ASSERT public.invoice_existing_link_dimension_conflict(
    'slit to 1220mm',
    NULL,
    NULL,
    1220,
    NULL,
    NULL,
    NULL
  ) IS NULL;

  ASSERT public.invoice_existing_link_dimension_conflict(
    'slit to 1000mm',
    NULL,
    NULL,
    1220,
    NULL,
    NULL,
    NULL
  ) LIKE '%width%';

  RAISE NOTICE 'confirm-existing-invoice-links validation passed';
END;
$$;

ROLLBACK;
