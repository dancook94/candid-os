-- Proposed: extend quote_requests with delivery address snapshot metadata
-- Review and apply manually in Supabase. Do not auto-run from the app.

BEGIN;

ALTER TABLE public.quote_requests
  ADD COLUMN IF NOT EXISTS delivery_country text,
  ADD COLUMN IF NOT EXISTS delivery_instructions text,
  ADD COLUMN IF NOT EXISTS delivery_address_label text,
  ADD COLUMN IF NOT EXISTS selected_company_address_id uuid
    REFERENCES public.company_addresses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_address_source text;

ALTER TABLE public.quote_requests
  DROP CONSTRAINT IF EXISTS quote_requests_delivery_address_source_check;

ALTER TABLE public.quote_requests
  ADD CONSTRAINT quote_requests_delivery_address_source_check
  CHECK (
    delivery_address_source IS NULL
    OR delivery_address_source IN ('saved', 'new', 'new_saved')
  );

CREATE INDEX IF NOT EXISTS quote_requests_selected_company_address_id_idx
  ON public.quote_requests (selected_company_address_id)
  WHERE selected_company_address_id IS NOT NULL;

COMMENT ON COLUMN public.quote_requests.selected_company_address_id IS
  'Traceability link to company_addresses at submission time. Snapshot columns remain authoritative.';
COMMENT ON COLUMN public.quote_requests.delivery_address_source IS
  'How the delivery address was captured: saved, new, or new_saved.';

COMMIT;
