-- Purchasing foundation. Apply manually after the live checks in the PO-04 report.
-- This migration does not write material_prices, does not allocate job numbers,
-- and does not read a customer purchase-order reference.
--
-- Lock order for every commercial change:
--   1. purchase_orders
--   2. purchase_order_revisions
--   3. purchase_order_lines ordered by id
--   4. purchase_order_counters
-- Email dispatch rows are locked only after the purchase order.

BEGIN;

-- ---------------------------------------------------------------------------
-- Capability. Admins issue without this flag. Only production staff can hold it.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN can_issue_purchase_orders boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_purchase_order_issuer_role_check
  CHECK (can_issue_purchase_orders = false OR user_role = 'production');

COMMENT ON COLUMN public.profiles.can_issue_purchase_orders IS
  'Approved production staff with this flag may issue purchase orders. Admins do not need it.';

ALTER TABLE public.suppliers
  ADD COLUMN orders_email text;

ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_orders_email_check
  CHECK (
    orders_email IS NULL
    OR orders_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  );

CREATE OR REPLACE FUNCTION public.suppliers_normalize_orders_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.orders_email IS NULL OR btrim(NEW.orders_email) = '' THEN
    NEW.orders_email := NULL;
  ELSE
    NEW.orders_email := lower(btrim(NEW.orders_email));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS suppliers_normalize_orders_email ON public.suppliers;
CREATE TRIGGER suppliers_normalize_orders_email
  BEFORE INSERT OR UPDATE OF orders_email ON public.suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.suppliers_normalize_orders_email();

CREATE OR REPLACE FUNCTION public.can_issue_purchase_orders()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.is_approved_candid_admin()
    OR EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      WHERE profile.id = auth.uid()
        AND profile.account_status = 'approved'
        AND profile.user_role = 'production'
        AND profile.can_issue_purchase_orders
    );
$$;

COMMENT ON FUNCTION public.can_issue_purchase_orders() IS
  'Approved admins, or approved production staff who have been assigned purchase-order issuing.';

-- ---------------------------------------------------------------------------
-- Documents, revisions, receipts and the supplier email outbox.
-- ---------------------------------------------------------------------------

CREATE TABLE public.purchase_order_counters (
  id boolean PRIMARY KEY DEFAULT true,
  last_number integer NOT NULL,
  CONSTRAINT purchase_order_counters_singleton CHECK (id),
  CONSTRAINT purchase_order_counters_start CHECK (last_number >= 1000)
);

INSERT INTO public.purchase_order_counters (id, last_number)
VALUES (true, 1000);

CREATE TABLE public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text UNIQUE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft',
  current_issued_revision_id uuid,
  current_draft_revision_id uuid,
  created_by uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_orders_po_number_check CHECK (
    po_number IS NULL OR po_number ~ '^PO-[1-9][0-9]*$'
  ),
  CONSTRAINT purchase_orders_status_check CHECK (
    status IN ('draft', 'issued', 'partially_received', 'received', 'cancelled')
  ),
  CONSTRAINT purchase_orders_distinct_revisions_check CHECK (
    current_issued_revision_id IS NULL
    OR current_draft_revision_id IS NULL
    OR current_issued_revision_id <> current_draft_revision_id
  )
);

CREATE TABLE public.purchase_order_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders (id) ON DELETE RESTRICT,
  revision_number integer NOT NULL,
  state text NOT NULL,
  supplier_name text NOT NULL,
  supplier_orders_email text,
  currency text NOT NULL DEFAULT 'GBP',
  vat_treatment text NOT NULL,
  vat_rate numeric(6,4) NOT NULL,
  delivery_method text NOT NULL,
  delivery_recipient text,
  delivery_line_1 text,
  delivery_line_2 text,
  delivery_city text,
  delivery_county text,
  delivery_postcode text,
  delivery_country text NOT NULL DEFAULT 'United Kingdom',
  delivery_instructions text,
  delivery_date date,
  delivery_charge_ex_vat numeric(12,2) NOT NULL DEFAULT 0,
  delivery_charge_method text NOT NULL DEFAULT 'proportional',
  goods_ex_vat numeric(12,2) NOT NULL DEFAULT 0,
  delivery_ex_vat numeric(12,2) NOT NULL DEFAULT 0,
  subtotal_ex_vat numeric(12,2) NOT NULL DEFAULT 0,
  vat_total numeric(12,2) NOT NULL DEFAULT 0,
  total_inc_vat numeric(12,2) NOT NULL DEFAULT 0,
  issued_at timestamptz,
  issued_by uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
  issue_idempotency_key text,
  pdf_storage_path text,
  pdf_sha256 text,
  pdf_byte_size integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_order_revisions_number_positive CHECK (revision_number >= 1),
  CONSTRAINT purchase_order_revisions_number_unique UNIQUE (purchase_order_id, revision_number),
  CONSTRAINT purchase_order_revisions_state_check CHECK (
    state IN ('draft', 'issued', 'superseded', 'cancelled')
  ),
  CONSTRAINT purchase_order_revisions_supplier_name_check CHECK (btrim(supplier_name) <> ''),
  CONSTRAINT purchase_order_revisions_currency_check CHECK (currency = 'GBP'),
  CONSTRAINT purchase_order_revisions_vat_treatment_check CHECK (
    vat_treatment IN ('standard', 'zero_rated', 'exempt', 'reverse_charge', 'outside_scope')
  ),
  CONSTRAINT purchase_order_revisions_vat_rate_check CHECK (vat_rate >= 0 AND vat_rate <= 1),
  CONSTRAINT purchase_order_revisions_delivery_method_check CHECK (
    delivery_method IN ('workshop', 'custom')
  ),
  CONSTRAINT purchase_order_revisions_delivery_charge_check CHECK (
    delivery_charge_ex_vat >= 0
    AND delivery_charge_method IN ('proportional', 'manual')
  ),
  CONSTRAINT purchase_order_revisions_totals_check CHECK (
    goods_ex_vat >= 0
    AND delivery_ex_vat = delivery_charge_ex_vat
    AND subtotal_ex_vat = goods_ex_vat + delivery_ex_vat
    AND vat_total >= 0
    AND total_inc_vat = subtotal_ex_vat + vat_total
  ),
  CONSTRAINT purchase_order_revisions_email_check CHECK (
    supplier_orders_email IS NULL
    OR supplier_orders_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  CONSTRAINT purchase_order_revisions_issued_snapshot_check CHECK (
    state = 'draft'
    OR (
      supplier_orders_email IS NOT NULL
      AND delivery_line_1 IS NOT NULL
      AND btrim(delivery_line_1) <> ''
      AND delivery_postcode IS NOT NULL
      AND btrim(delivery_postcode) <> ''
      AND issued_at IS NOT NULL
      AND issued_by IS NOT NULL
    )
  ),
  CONSTRAINT purchase_order_revisions_issue_key_check CHECK (
    issue_idempotency_key IS NULL
    OR (
      char_length(btrim(issue_idempotency_key)) BETWEEN 1 AND 200
      AND state <> 'draft'
    )
  ),
  CONSTRAINT purchase_order_revisions_pdf_check CHECK (
    (
      pdf_storage_path IS NULL
      AND pdf_sha256 IS NULL
      AND pdf_byte_size IS NULL
    )
    OR (
      pdf_storage_path IS NOT NULL
      AND pdf_sha256 ~ '^[0-9a-f]{64}$'
      AND pdf_byte_size > 0
      AND pdf_byte_size <= 10485760
    )
  ),
  CONSTRAINT purchase_order_revisions_text_length_check CHECK (
    (delivery_recipient IS NULL OR char_length(delivery_recipient) <= 200)
    AND (delivery_line_1 IS NULL OR char_length(delivery_line_1) <= 200)
    AND (delivery_line_2 IS NULL OR char_length(delivery_line_2) <= 200)
    AND (delivery_city IS NULL OR char_length(delivery_city) <= 120)
    AND (delivery_county IS NULL OR char_length(delivery_county) <= 120)
    AND (delivery_postcode IS NULL OR char_length(delivery_postcode) <= 20)
    AND (delivery_country IS NULL OR char_length(delivery_country) <= 80)
    AND (delivery_instructions IS NULL OR char_length(delivery_instructions) <= 2000)
  )
);

CREATE UNIQUE INDEX purchase_order_revisions_one_draft_idx
  ON public.purchase_order_revisions (purchase_order_id)
  WHERE state = 'draft';

CREATE UNIQUE INDEX purchase_order_revisions_one_issued_idx
  ON public.purchase_order_revisions (purchase_order_id)
  WHERE state = 'issued';

CREATE UNIQUE INDEX purchase_order_revisions_issue_key_idx
  ON public.purchase_order_revisions (issue_idempotency_key)
  WHERE issue_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX purchase_order_revisions_pdf_path_idx
  ON public.purchase_order_revisions (pdf_storage_path)
  WHERE pdf_storage_path IS NOT NULL;

CREATE INDEX purchase_order_revisions_order_idx
  ON public.purchase_order_revisions (purchase_order_id, revision_number);

ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_current_issued_revision_fkey
  FOREIGN KEY (current_issued_revision_id)
  REFERENCES public.purchase_order_revisions (id)
  ON DELETE RESTRICT;

ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_current_draft_revision_fkey
  FOREIGN KEY (current_draft_revision_id)
  REFERENCES public.purchase_order_revisions (id)
  ON DELETE RESTRICT;

CREATE TABLE public.purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES public.purchase_order_revisions (id) ON DELETE RESTRICT,
  line_number integer NOT NULL,
  line_kind text NOT NULL,
  material_id uuid REFERENCES public.materials (id) ON DELETE RESTRICT,
  material_supplier_product_id uuid REFERENCES public.material_supplier_products (id) ON DELETE RESTRICT,
  material_price_id uuid REFERENCES public.material_prices (id) ON DELETE RESTRICT,
  description text NOT NULL,
  supplier_sku text,
  unit text NOT NULL,
  quantity numeric(14,4) NOT NULL,
  unit_price_ex_vat numeric(14,4) NOT NULL,
  line_total_ex_vat numeric(12,2) NOT NULL,
  vat_treatment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_order_lines_number_unique UNIQUE (revision_id, line_number),
  CONSTRAINT purchase_order_lines_number_positive CHECK (line_number >= 1),
  CONSTRAINT purchase_order_lines_kind_check CHECK (line_kind IN ('catalogue', 'manual')),
  CONSTRAINT purchase_order_lines_description_check CHECK (
    char_length(btrim(description)) BETWEEN 1 AND 500
  ),
  CONSTRAINT purchase_order_lines_unit_check CHECK (
    char_length(btrim(unit)) BETWEEN 1 AND 40
  ),
  CONSTRAINT purchase_order_lines_quantity_check CHECK (
    quantity > 0 AND quantity = round(quantity, 4)
  ),
  CONSTRAINT purchase_order_lines_price_check CHECK (
    unit_price_ex_vat > 0 AND unit_price_ex_vat = round(unit_price_ex_vat, 4)
  ),
  CONSTRAINT purchase_order_lines_total_check CHECK (line_total_ex_vat > 0),
  CONSTRAINT purchase_order_lines_vat_treatment_check CHECK (
    vat_treatment IS NULL
    OR vat_treatment IN ('standard', 'zero_rated', 'exempt', 'reverse_charge', 'outside_scope')
  ),
  CONSTRAINT purchase_order_lines_catalogue_ids_check CHECK (
    (
      line_kind = 'manual'
      AND material_id IS NULL
      AND material_supplier_product_id IS NULL
      AND material_price_id IS NULL
    )
    OR (
      line_kind = 'catalogue'
      AND material_id IS NOT NULL
      AND material_supplier_product_id IS NOT NULL
      AND material_price_id IS NOT NULL
    )
  )
);

CREATE INDEX purchase_order_lines_revision_idx
  ON public.purchase_order_lines (revision_id, line_number);

CREATE INDEX purchase_order_lines_price_idx
  ON public.purchase_order_lines (material_price_id);

CREATE TABLE public.purchase_order_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid NOT NULL REFERENCES public.purchase_order_lines (id) ON DELETE RESTRICT,
  target text NOT NULL,
  job_id uuid REFERENCES public.jobs (id) ON DELETE RESTRICT,
  quantity numeric(14,4) NOT NULL,
  cost_ex_vat numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_order_allocations_target_check CHECK (
    (
      target = 'job'
      AND job_id IS NOT NULL
    )
    OR (
      target = 'stock'
      AND job_id IS NULL
    )
  ),
  CONSTRAINT purchase_order_allocations_quantity_check CHECK (
    quantity > 0 AND quantity = round(quantity, 4)
  ),
  CONSTRAINT purchase_order_allocations_cost_check CHECK (
    cost_ex_vat >= 0 AND cost_ex_vat = round(cost_ex_vat, 2)
  )
);

CREATE UNIQUE INDEX purchase_order_allocations_job_idx
  ON public.purchase_order_allocations (line_id, job_id)
  WHERE job_id IS NOT NULL;

CREATE UNIQUE INDEX purchase_order_allocations_stock_idx
  ON public.purchase_order_allocations (line_id)
  WHERE target = 'stock';

CREATE INDEX purchase_order_allocations_line_idx
  ON public.purchase_order_allocations (line_id);

CREATE INDEX purchase_order_allocations_job_lookup_idx
  ON public.purchase_order_allocations (job_id);

CREATE TABLE public.purchase_order_charge_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES public.purchase_order_revisions (id) ON DELETE RESTRICT,
  target text NOT NULL,
  job_id uuid REFERENCES public.jobs (id) ON DELETE RESTRICT,
  amount_ex_vat numeric(12,2) NOT NULL,
  method text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_order_charge_allocations_target_check CHECK (
    (
      target = 'job'
      AND job_id IS NOT NULL
    )
    OR (
      target = 'stock'
      AND job_id IS NULL
    )
  ),
  CONSTRAINT purchase_order_charge_allocations_amount_check CHECK (
    amount_ex_vat >= 0 AND amount_ex_vat = round(amount_ex_vat, 2)
  ),
  CONSTRAINT purchase_order_charge_allocations_method_check CHECK (
    method IN ('proportional', 'manual')
  )
);

CREATE UNIQUE INDEX purchase_order_charge_allocations_job_idx
  ON public.purchase_order_charge_allocations (revision_id, job_id)
  WHERE job_id IS NOT NULL;

CREATE UNIQUE INDEX purchase_order_charge_allocations_stock_idx
  ON public.purchase_order_charge_allocations (revision_id)
  WHERE target = 'stock';

CREATE INDEX purchase_order_charge_allocations_revision_idx
  ON public.purchase_order_charge_allocations (revision_id);

CREATE TABLE public.purchase_order_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders (id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL REFERENCES public.purchase_order_revisions (id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  received_by uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_order_receipts_key_unique UNIQUE (purchase_order_id, idempotency_key),
  CONSTRAINT purchase_order_receipts_key_check CHECK (
    char_length(btrim(idempotency_key)) BETWEEN 1 AND 200
  ),
  CONSTRAINT purchase_order_receipts_note_check CHECK (
    note IS NULL OR char_length(note) <= 2000
  )
);

CREATE INDEX purchase_order_receipts_order_idx
  ON public.purchase_order_receipts (purchase_order_id, received_at DESC);

CREATE TABLE public.purchase_order_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.purchase_order_receipts (id) ON DELETE RESTRICT,
  line_id uuid NOT NULL REFERENCES public.purchase_order_lines (id) ON DELETE RESTRICT,
  quantity_received numeric(14,4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_order_receipt_lines_unique UNIQUE (receipt_id, line_id),
  CONSTRAINT purchase_order_receipt_lines_quantity_check CHECK (
    quantity_received > 0 AND quantity_received = round(quantity_received, 4)
  )
);

CREATE INDEX purchase_order_receipt_lines_line_idx
  ON public.purchase_order_receipt_lines (line_id);

CREATE TABLE public.purchase_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders (id) ON DELETE RESTRICT,
  revision_id uuid REFERENCES public.purchase_order_revisions (id) ON DELETE SET NULL,
  receipt_id uuid REFERENCES public.purchase_order_receipts (id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_order_events_action_check CHECK (
    action IN (
      'draft_created',
      'draft_saved',
      'draft_deleted',
      'prices_refreshed',
      'issued',
      'pdf_stored',
      'email_sent',
      'email_failed',
      'email_unknown',
      'email_retry_allowed',
      'email_marked_sent',
      'revision_opened',
      'cancelled',
      'receipt_recorded',
      'delivery_allocation_overridden'
    )
  )
);

CREATE INDEX purchase_order_events_order_idx
  ON public.purchase_order_events (purchase_order_id, created_at DESC);

CREATE TABLE public.purchase_order_email_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES public.purchase_order_revisions (id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  claim_token uuid,
  provider_message_id text,
  last_error text,
  requested_by uuid REFERENCES public.profiles (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_order_email_dispatches_revision_unique UNIQUE (revision_id),
  CONSTRAINT purchase_order_email_dispatches_status_check CHECK (
    status IN ('queued', 'sending', 'sent', 'failed', 'unknown')
  ),
  CONSTRAINT purchase_order_email_dispatches_attempt_check CHECK (attempt_count >= 0),
  CONSTRAINT purchase_order_email_dispatches_key_check CHECK (
    idempotency_key = 'purchase_order_sent:' || revision_id::text
  )
);

CREATE INDEX purchase_order_email_dispatches_status_idx
  ON public.purchase_order_email_dispatches (status, lease_until);

COMMENT ON TABLE public.purchase_order_counters IS
  'One row. last_number starts at 1000 so the first issued number is PO-1001. Increment only inside the issue transaction.';

COMMENT ON TABLE public.purchase_orders IS
  'One supplier. current_issued_revision_id and current_draft_revision_id are separate so an amendment draft does not hide the issued document.';

COMMENT ON TABLE public.purchase_order_revisions IS
  'Commercial snapshot. Issued rows stay valid while a replacement draft exists. Email send state lives on the outbox, not here.';

COMMENT ON TABLE public.purchase_order_lines IS
  'Catalogue lines reference an approved price. Manual lines have no catalogue ids and must never create a material price.';

COMMENT ON TABLE public.purchase_order_email_dispatches IS
  'At-least-once supplier email outbox. Unknown means the provider result was lost. Unknown is not claimed again unless staff explicitly allow a retry.';

COMMENT ON COLUMN public.purchase_order_revisions.vat_rate IS
  'Standard VAT rate snapshotted as a fraction, for example 0.2000. It is not a percent.';

-- ---------------------------------------------------------------------------
-- Internal guards. Direct writes are rejected unless a purchasing function
-- has set the transaction-local candid.po_write flag. Issued commercial rows
-- stay frozen even when that flag is set.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.purchase_order_begin_write()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('candid.po_write', 'on', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_require_write()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_setting('candid.po_write', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Purchase orders must be changed through purchasing functions'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_require_purchaser()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_issue_purchase_orders() THEN
    RAISE EXCEPTION 'You do not have permission to issue purchase orders'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_revision_commercial(
  p public.purchase_order_revisions
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'supplier_name', p.supplier_name,
    'supplier_orders_email', p.supplier_orders_email,
    'currency', p.currency,
    'vat_treatment', p.vat_treatment,
    'vat_rate', p.vat_rate,
    'delivery_method', p.delivery_method,
    'delivery_recipient', p.delivery_recipient,
    'delivery_line_1', p.delivery_line_1,
    'delivery_line_2', p.delivery_line_2,
    'delivery_city', p.delivery_city,
    'delivery_county', p.delivery_county,
    'delivery_postcode', p.delivery_postcode,
    'delivery_country', p.delivery_country,
    'delivery_instructions', p.delivery_instructions,
    'delivery_date', p.delivery_date,
    'delivery_charge_ex_vat', p.delivery_charge_ex_vat,
    'delivery_charge_method', p.delivery_charge_method,
    'goods_ex_vat', p.goods_ex_vat,
    'delivery_ex_vat', p.delivery_ex_vat,
    'subtotal_ex_vat', p.subtotal_ex_vat,
    'vat_total', p.vat_total,
    'total_inc_vat', p.total_inc_vat,
    'issued_at', p.issued_at,
    'issued_by', p.issued_by,
    'issue_idempotency_key', p.issue_idempotency_key
  );
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_counters_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.purchase_order_require_write();

  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'The purchase order counter cannot be replaced'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.last_number IS DISTINCT FROM OLD.last_number + 1 THEN
    RAISE EXCEPTION 'The purchase order counter can only move forward by one'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_assert_pointers(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.purchase_orders;
  v_state text;
  v_issued_at timestamptz;
  v_revision_order uuid;
BEGIN
  SELECT * INTO v_order
  FROM public.purchase_orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_order.current_draft_revision_id IS NOT NULL THEN
    SELECT state, purchase_order_id
    INTO v_state, v_revision_order
    FROM public.purchase_order_revisions
    WHERE id = v_order.current_draft_revision_id;

    IF NOT FOUND
      OR v_revision_order IS DISTINCT FROM p_order_id
      OR v_state IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'The current draft revision is not a draft of this purchase order'
        USING ERRCODE = '23514';
    END IF;
  ELSIF v_order.status = 'draft' THEN
    RAISE EXCEPTION 'A draft purchase order needs its draft revision'
      USING ERRCODE = '23514';
  END IF;

  IF v_order.status = 'cancelled' THEN
    IF v_order.current_draft_revision_id IS NOT NULL
      OR v_order.current_issued_revision_id IS NULL THEN
      RAISE EXCEPTION 'A cancelled purchase order must keep its cancelled revision and no draft'
        USING ERRCODE = '23514';
    END IF;

    SELECT state, issued_at, purchase_order_id
    INTO v_state, v_issued_at, v_revision_order
    FROM public.purchase_order_revisions
    WHERE id = v_order.current_issued_revision_id;

    IF NOT FOUND
      OR v_revision_order IS DISTINCT FROM p_order_id
      OR v_state IS DISTINCT FROM 'cancelled'
      OR v_issued_at IS NULL THEN
      RAISE EXCEPTION 'A cancelled purchase order must point at its cancelled issued revision'
        USING ERRCODE = '23514';
    END IF;

    RETURN;
  END IF;

  IF v_order.current_issued_revision_id IS NOT NULL THEN
    SELECT state, issued_at, purchase_order_id
    INTO v_state, v_issued_at, v_revision_order
    FROM public.purchase_order_revisions
    WHERE id = v_order.current_issued_revision_id;

    IF NOT FOUND
      OR v_revision_order IS DISTINCT FROM p_order_id
      OR v_state IS DISTINCT FROM 'issued'
      OR v_issued_at IS NULL THEN
      RAISE EXCEPTION 'The current issued revision must be the issued revision of this purchase order'
        USING ERRCODE = '23514';
    END IF;
  ELSIF v_order.status IN ('issued', 'partially_received', 'received') THEN
    RAISE EXCEPTION 'An issued purchase order needs its issued revision'
      USING ERRCODE = '23514';
  END IF;

  IF v_order.status = 'draft' AND v_order.current_issued_revision_id IS NOT NULL THEN
    RAISE EXCEPTION 'A draft purchase order cannot have an issued revision'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_revision_pointer_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'purchase_orders' THEN
    IF TG_OP <> 'DELETE' THEN
      PERFORM public.purchase_order_assert_pointers(NEW.id);
    END IF;
  ELSE
    PERFORM public.purchase_order_assert_pointers(
      COALESCE(NEW.purchase_order_id, OLD.purchase_order_id)
    );
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_orders_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.purchase_order_require_write();

  IF TG_OP = 'DELETE' THEN
    IF OLD.po_number IS NOT NULL
      OR OLD.status <> 'draft'
      OR OLD.current_issued_revision_id IS NOT NULL THEN
      RAISE EXCEPTION 'Issued purchase orders cannot be deleted'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft'
      OR NEW.po_number IS NOT NULL
      OR NEW.current_issued_revision_id IS NOT NULL
      OR NEW.current_draft_revision_id IS NOT NULL
      OR NEW.created_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'A purchase order must be created as an empty draft for the current user'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id THEN
    RAISE EXCEPTION 'Purchase order identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.po_number IS NOT NULL AND NEW.po_number IS DISTINCT FROM OLD.po_number THEN
    RAISE EXCEPTION 'A purchase order number cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'issued')
    OR OLD.status = 'issued' AND NEW.status NOT IN ('issued', 'partially_received', 'received', 'cancelled')
    OR OLD.status = 'partially_received' AND NEW.status NOT IN ('partially_received', 'received')
    OR OLD.status = 'received' AND NEW.status <> 'received'
    OR OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'That purchase order status change is not allowed'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_revisions_normalize_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.supplier_orders_email IS NULL OR btrim(NEW.supplier_orders_email) = '' THEN
    NEW.supplier_orders_email := NULL;
  ELSE
    NEW.supplier_orders_email := lower(btrim(NEW.supplier_orders_email));
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_revisions_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.purchase_order_require_write();

  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'draft' THEN
      RAISE EXCEPTION 'Issued purchase order revisions cannot be deleted'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.state IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Purchase order revisions must be created as drafts'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id
    OR NEW.revision_number IS DISTINCT FROM OLD.revision_number
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Purchase order revision identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.state = 'draft' AND NEW.state = 'draft' THEN
    RETURN NEW;
  END IF;

  IF OLD.state = 'draft' AND NEW.state = 'issued' THEN
    RETURN NEW;
  END IF;

  IF OLD.state = 'issued' AND NEW.state IN ('issued', 'superseded', 'cancelled') THEN
    IF public.purchase_order_revision_commercial(OLD)
      IS DISTINCT FROM public.purchase_order_revision_commercial(NEW) THEN
      RAISE EXCEPTION 'Issued purchase order commercial data is immutable'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.state <> 'issued' AND (
      OLD.pdf_storage_path IS DISTINCT FROM NEW.pdf_storage_path
      OR OLD.pdf_sha256 IS DISTINCT FROM NEW.pdf_sha256
      OR OLD.pdf_byte_size IS DISTINCT FROM NEW.pdf_byte_size
    ) THEN
      RAISE EXCEPTION 'Issued purchase order commercial data is immutable'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'That purchase order revision change is not allowed'
    USING ERRCODE = '23514';
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_lines_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_revision_id uuid;
  v_state text;
  v_supplier_id uuid;
  v_price numeric;
  v_currency text;
  v_price_unit text;
  v_price_product uuid;
  v_product_material uuid;
  v_product_supplier uuid;
  v_sku text;
  v_description text;
  v_purchase_unit text;
  v_material_active boolean;
  v_product_active boolean;
  v_supplier_active boolean;
  v_snapshot_copy boolean;
BEGIN
  PERFORM public.purchase_order_require_write();
  v_revision_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.revision_id ELSE NEW.revision_id END;

  SELECT state INTO v_state
  FROM public.purchase_order_revisions
  WHERE id = v_revision_id;

  IF v_state IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Issued purchase order lines cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.revision_id IS DISTINCT FROM OLD.revision_id
    OR NEW.line_number IS DISTINCT FROM OLD.line_number
  ) THEN
    RAISE EXCEPTION 'Purchase order line identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF round(NEW.quantity * NEW.unit_price_ex_vat, 2) IS DISTINCT FROM NEW.line_total_ex_vat THEN
    RAISE EXCEPTION 'Purchase order line total does not match the quantity and price'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.line_kind = 'manual' THEN
    RETURN NEW;
  END IF;

  v_snapshot_copy := current_setting('candid.po_snapshot_copy', true) = 'on';

  SELECT
    price.price,
    price.currency,
    price.price_unit,
    price.material_supplier_product_id,
    product.material_id,
    product.supplier_id,
    product.supplier_sku,
    product.supplier_description,
    product.active,
    material.purchase_unit,
    material.active,
    supplier.active
  INTO
    v_price,
    v_currency,
    v_price_unit,
    v_price_product,
    v_product_material,
    v_product_supplier,
    v_sku,
    v_description,
    v_product_active,
    v_purchase_unit,
    v_material_active,
    v_supplier_active
  FROM public.material_prices AS price
  JOIN public.material_supplier_products AS product
    ON product.id = price.material_supplier_product_id
  JOIN public.materials AS material
    ON material.id = product.material_id
  JOIN public.suppliers AS supplier
    ON supplier.id = product.supplier_id
  WHERE price.id = NEW.material_price_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approved price was not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT purchase_order.supplier_id INTO v_supplier_id
  FROM public.purchase_order_revisions AS revision
  JOIN public.purchase_orders AS purchase_order
    ON purchase_order.id = revision.purchase_order_id
  WHERE revision.id = NEW.revision_id;

  IF v_price_product IS DISTINCT FROM NEW.material_supplier_product_id
    OR v_product_material IS DISTINCT FROM NEW.material_id
    OR v_product_supplier IS DISTINCT FROM v_supplier_id THEN
    RAISE EXCEPTION 'The catalogue material, product, price and supplier do not belong together'
      USING ERRCODE = '23514';
  END IF;

  IF v_currency IS DISTINCT FROM 'GBP'
    OR v_price <= 0
    OR v_price IS DISTINCT FROM round(v_price, 4)
    OR NEW.unit_price_ex_vat IS DISTINCT FROM round(v_price, 4)
    OR NEW.unit IS DISTINCT FROM v_price_unit THEN
    RAISE EXCEPTION 'Catalogue lines must keep the approved GBP price and unit'
      USING ERRCODE = '23514';
  END IF;

  IF NOT v_snapshot_copy AND (
    NOT v_material_active
    OR NOT v_product_active
    OR NOT v_supplier_active
    OR NEW.unit IS DISTINCT FROM v_purchase_unit
    OR NEW.description IS DISTINCT FROM v_description
    OR NEW.supplier_sku IS DISTINCT FROM v_sku
  ) THEN
    RAISE EXCEPTION 'Catalogue lines must use the current active supplier product'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_allocations_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_line_id uuid;
  v_state text;
  v_quantity numeric(14,4);
  v_allocated numeric(14,4);
BEGIN
  PERFORM public.purchase_order_require_write();
  v_line_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.line_id ELSE NEW.line_id END;

  SELECT revision.state, line.quantity
  INTO v_state, v_quantity
  FROM public.purchase_order_lines AS line
  JOIN public.purchase_order_revisions AS revision
    ON revision.id = line.revision_id
  WHERE line.id = v_line_id;

  IF v_state IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Issued purchase order allocations cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.line_id IS DISTINCT FROM OLD.line_id
  ) THEN
    RAISE EXCEPTION 'Purchase order allocation identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(sum(allocation.quantity), 0)
  INTO v_allocated
  FROM public.purchase_order_allocations AS allocation
  WHERE allocation.line_id = NEW.line_id
    AND allocation.id IS DISTINCT FROM NEW.id;

  IF v_allocated + NEW.quantity > v_quantity THEN
    RAISE EXCEPTION 'Allocations exceed the purchased quantity'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_charge_allocations_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_revision_id uuid;
  v_state text;
  v_method text;
BEGIN
  PERFORM public.purchase_order_require_write();
  v_revision_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.revision_id ELSE NEW.revision_id END;

  SELECT state, delivery_charge_method
  INTO v_state, v_method
  FROM public.purchase_order_revisions
  WHERE id = v_revision_id;

  IF v_state IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Issued delivery allocations cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.method IS DISTINCT FROM v_method THEN
    RAISE EXCEPTION 'Delivery allocation method does not match the revision'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_receipts_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_issued_revision uuid;
  v_status text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Purchase order receipts cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  PERFORM public.purchase_order_require_write();

  IF NEW.received_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Purchase order receipts must record the current user'
      USING ERRCODE = '42501';
  END IF;

  SELECT current_issued_revision_id, status
  INTO v_issued_revision, v_status
  FROM public.purchase_orders
  WHERE id = NEW.purchase_order_id;

  IF v_status = 'cancelled'
    OR v_issued_revision IS NULL
    OR NEW.revision_id IS DISTINCT FROM v_issued_revision THEN
    RAISE EXCEPTION 'Goods can only be received against the current issued revision'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_receipt_lines_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ordered numeric(14,4);
  v_received numeric(14,4);
  v_line_revision uuid;
  v_line_order uuid;
  v_receipt_revision uuid;
  v_receipt_order uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Purchase order receipt lines cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  PERFORM public.purchase_order_require_write();

  SELECT
    line.quantity,
    line.revision_id,
    revision.purchase_order_id
  INTO v_ordered, v_line_revision, v_line_order
  FROM public.purchase_order_lines AS line
  JOIN public.purchase_order_revisions AS revision
    ON revision.id = line.revision_id
  WHERE line.id = NEW.line_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order line was not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT revision_id, purchase_order_id
  INTO v_receipt_revision, v_receipt_order
  FROM public.purchase_order_receipts
  WHERE id = NEW.receipt_id;

  IF v_line_order IS DISTINCT FROM v_receipt_order
    OR v_line_revision IS DISTINCT FROM v_receipt_revision THEN
    RAISE EXCEPTION 'Receipt lines must belong to the current issued revision'
      USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(sum(receipt_line.quantity_received), 0)
  INTO v_received
  FROM public.purchase_order_receipt_lines AS receipt_line
  WHERE receipt_line.line_id = NEW.line_id;

  IF v_received + NEW.quantity_received > v_ordered THEN
    RAISE EXCEPTION 'Received quantity exceeds the ordered quantity'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_events_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.purchase_order_require_write();

  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1
      FROM public.purchase_order_revisions AS revision
      WHERE revision.id = OLD.revision_id
        AND revision.state = 'draft'
    ) OR EXISTS (
      SELECT 1
      FROM public.purchase_orders AS purchase_order
      WHERE purchase_order.id = OLD.purchase_order_id
        AND purchase_order.status = 'draft'
        AND purchase_order.po_number IS NULL
    ) THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION 'Issued purchase order events cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Purchase order events cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.actor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Purchase order events must record the current user'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_email_dispatches_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.purchase_order_require_write();

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Purchase order email records cannot be deleted'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'queued' OR NEW.attempt_count <> 0 THEN
      RAISE EXCEPTION 'Purchase order email must start queued'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.revision_id IS DISTINCT FROM OLD.revision_id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.attempt_count < OLD.attempt_count THEN
    RAISE EXCEPTION 'Purchase order email identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'sent' AND NEW.status IS DISTINCT FROM 'sent' THEN
    RAISE EXCEPTION 'A sent purchase order email cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'unknown' AND NEW.status = 'sending' THEN
    RAISE EXCEPTION 'An unknown purchase order email cannot be retried automatically'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    OLD.status = NEW.status
    OR (OLD.status = 'queued' AND NEW.status = 'sending')
    OR (OLD.status = 'failed' AND NEW.status = 'sending')
    OR (OLD.status = 'sending' AND NEW.status IN ('sent', 'failed', 'unknown'))
    OR (OLD.status = 'unknown' AND NEW.status IN ('sent', 'failed'))
  ) THEN
    RAISE EXCEPTION 'That purchase order email change is not allowed'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS purchase_order_counters_guard ON public.purchase_order_counters;
CREATE TRIGGER purchase_order_counters_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_order_counters
  FOR EACH ROW
  EXECUTE FUNCTION public.purchase_order_counters_guard();

DROP TRIGGER IF EXISTS purchase_orders_guard ON public.purchase_orders;
CREATE TRIGGER purchase_orders_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.purchase_orders_guard();

DROP TRIGGER IF EXISTS purchase_orders_set_updated_at ON public.purchase_orders;
CREATE TRIGGER purchase_orders_set_updated_at
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

DROP TRIGGER IF EXISTS purchase_order_revisions_normalize_email ON public.purchase_order_revisions;
CREATE TRIGGER purchase_order_revisions_normalize_email
  BEFORE INSERT OR UPDATE OF supplier_orders_email ON public.purchase_order_revisions
  FOR EACH ROW
  EXECUTE FUNCTION public.purchase_order_revisions_normalize_email();

DROP TRIGGER IF EXISTS purchase_order_revisions_z_guard ON public.purchase_order_revisions;
CREATE TRIGGER purchase_order_revisions_z_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_order_revisions
  FOR EACH ROW
  EXECUTE FUNCTION public.purchase_order_revisions_guard();

DROP TRIGGER IF EXISTS purchase_order_lines_guard ON public.purchase_order_lines;
CREATE TRIGGER purchase_order_lines_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_order_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.purchase_order_lines_guard();

DROP TRIGGER IF EXISTS purchase_order_allocations_guard ON public.purchase_order_allocations;
CREATE TRIGGER purchase_order_allocations_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_order_allocations
  FOR EACH ROW
  EXECUTE FUNCTION public.purchase_order_allocations_guard();

DROP TRIGGER IF EXISTS purchase_order_charge_allocations_guard ON public.purchase_order_charge_allocations;
CREATE TRIGGER purchase_order_charge_allocations_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_order_charge_allocations
  FOR EACH ROW
  EXECUTE FUNCTION public.purchase_order_charge_allocations_guard();

DROP TRIGGER IF EXISTS purchase_order_receipts_guard ON public.purchase_order_receipts;
CREATE TRIGGER purchase_order_receipts_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_order_receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.purchase_order_receipts_guard();

DROP TRIGGER IF EXISTS purchase_order_receipt_lines_guard ON public.purchase_order_receipt_lines;
CREATE TRIGGER purchase_order_receipt_lines_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_order_receipt_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.purchase_order_receipt_lines_guard();

DROP TRIGGER IF EXISTS purchase_order_events_guard ON public.purchase_order_events;
CREATE TRIGGER purchase_order_events_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_order_events
  FOR EACH ROW
  EXECUTE FUNCTION public.purchase_order_events_guard();

DROP TRIGGER IF EXISTS purchase_order_email_dispatches_guard ON public.purchase_order_email_dispatches;
CREATE TRIGGER purchase_order_email_dispatches_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_order_email_dispatches
  FOR EACH ROW
  EXECUTE FUNCTION public.purchase_order_email_dispatches_guard();

DROP TRIGGER IF EXISTS purchase_order_email_dispatches_set_updated_at ON public.purchase_order_email_dispatches;
CREATE TRIGGER purchase_order_email_dispatches_set_updated_at
  BEFORE UPDATE ON public.purchase_order_email_dispatches
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

DROP TRIGGER IF EXISTS purchase_orders_pointer_check ON public.purchase_orders;
CREATE CONSTRAINT TRIGGER purchase_orders_pointer_check
  AFTER INSERT OR UPDATE OR DELETE ON public.purchase_orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.purchase_order_revision_pointer_trigger();

DROP TRIGGER IF EXISTS purchase_order_revisions_pointer_check ON public.purchase_order_revisions;
CREATE CONSTRAINT TRIGGER purchase_order_revisions_pointer_check
  AFTER INSERT OR UPDATE OR DELETE ON public.purchase_order_revisions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.purchase_order_revision_pointer_trigger();

-- ---------------------------------------------------------------------------
-- Calculation helpers. These functions are not granted to application roles.
-- This migration never inserts into public.material_prices.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.purchase_order_assert_keys(
  p_object jsonb,
  p_allowed text[]
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_unknown text;
BEGIN
  IF p_object IS NULL OR jsonb_typeof(p_object) <> 'object' THEN
    RAISE EXCEPTION 'Purchase order data must be an object'
      USING ERRCODE = '22023';
  END IF;

  SELECT string_agg(key, ', ' ORDER BY key)
  INTO v_unknown
  FROM jsonb_object_keys(p_object) AS key
  WHERE key <> ALL (p_allowed);

  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'Unknown purchase order field: %', v_unknown
      USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_optional_text(
  p_object jsonb,
  p_key text,
  p_max integer
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_text text;
BEGIN
  IF NOT p_object ? p_key OR jsonb_typeof(p_object->p_key) = 'null' THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(p_object->p_key) <> 'string' THEN
    RAISE EXCEPTION '% must be text', p_key
      USING ERRCODE = '22023';
  END IF;

  v_text := btrim(p_object->>p_key);
  IF v_text = '' THEN
    RETURN NULL;
  END IF;

  IF char_length(v_text) > p_max THEN
    RAISE EXCEPTION '% is too long', p_key
      USING ERRCODE = '22023';
  END IF;

  RETURN v_text;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_numeric(
  p_value jsonb,
  p_label text,
  p_scale integer
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_numeric numeric;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
    RAISE EXCEPTION '% is required', p_label
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_value) NOT IN ('number', 'string') THEN
    RAISE EXCEPTION '% must be a number', p_label
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_numeric := (p_value #>> '{}')::numeric;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION '% must be a number', p_label
        USING ERRCODE = '22023';
  END;

  IF v_numeric IS DISTINCT FROM round(v_numeric, p_scale) THEN
    RAISE EXCEPTION '% has too many decimal places', p_label
      USING ERRCODE = '23514';
  END IF;

  RETURN v_numeric;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_uuid(
  p_value jsonb,
  p_label text
)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(p_value) <> 'string' THEN
    RAISE EXCEPTION '% must be an id', p_label
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    RETURN (p_value #>> '{}')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION '% must be an id', p_label
        USING ERRCODE = '22023';
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_standard_vat_rate()
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rate numeric;
BEGIN
  BEGIN
    SELECT default_vat_rate
    INTO v_rate
    FROM public.app_settings
    WHERE singleton IS TRUE
    LIMIT 1;
  EXCEPTION
    WHEN undefined_table OR undefined_column THEN
      RETURN 0.2000;
  END;

  IF v_rate IS NULL THEN
    RETURN 0.2000;
  END IF;

  IF v_rate < 0 OR v_rate > 1 OR v_rate IS DISTINCT FROM round(v_rate, 4) THEN
    RAISE EXCEPTION 'Application VAT rate is invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN v_rate;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_vat_amount(
  p_treatment text,
  p_net numeric,
  p_rate numeric
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_treatment IN ('zero_rated', 'exempt', 'outside_scope', 'reverse_charge') THEN
    RETURN 0;
  END IF;

  IF p_treatment IS DISTINCT FROM 'standard' THEN
    RAISE EXCEPTION 'VAT treatment is not supported'
      USING ERRCODE = '23514';
  END IF;

  RETURN round(coalesce(p_net, 0) * p_rate, 2);
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_workshop_address()
RETURNS TABLE (
  recipient text,
  line_1 text,
  line_2 text,
  city text,
  postcode text
)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_found boolean := false;
  v_name text;
  v_line_1 text;
  v_line_2 text;
  v_city text;
  v_postcode text;
BEGIN
  BEGIN
    SELECT
      company_name,
      address_line_1,
      address_line_2,
      address_city,
      address_postcode
    INTO v_name, v_line_1, v_line_2, v_city, v_postcode
    FROM public.app_settings
    WHERE singleton IS TRUE
    LIMIT 1;
    v_found := FOUND;
  EXCEPTION
    WHEN undefined_table OR undefined_column THEN
      v_found := false;
  END;

  IF NOT v_found THEN
    recipient := 'Candid Creative Limited';
    line_1 := 'Innovation House';
    line_2 := 'Cray Road, Sidcup';
    city := NULL;
    postcode := 'DA14 5DP';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_line_1 IS NULL OR btrim(v_line_1) = ''
    OR v_postcode IS NULL OR btrim(v_postcode) = '' THEN
    RAISE EXCEPTION 'Workshop address is not configured'
      USING ERRCODE = '23514';
  END IF;

  recipient := coalesce(nullif(btrim(coalesce(v_name, '')), ''), 'Candid Creative Limited');
  line_1 := btrim(v_line_1);
  line_2 := nullif(btrim(coalesce(v_line_2, '')), '');
  city := nullif(btrim(coalesce(v_city, '')), '');
  postcode := btrim(v_postcode);
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_event(
  p_order_id uuid,
  p_revision_id uuid,
  p_receipt_id uuid,
  p_action text,
  p_metadata jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.purchase_order_require_write();

  INSERT INTO public.purchase_order_events (
    purchase_order_id,
    revision_id,
    receipt_id,
    actor_id,
    action,
    metadata
  )
  VALUES (
    p_order_id,
    p_revision_id,
    p_receipt_id,
    auth.uid(),
    p_action,
    coalesce(p_metadata, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_lock_lines(p_revision_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM line.id
  FROM public.purchase_order_lines AS line
  WHERE line.revision_id = p_revision_id
  ORDER BY line.id
  FOR UPDATE;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_received_quantity(p_order_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(sum(receipt_line.quantity_received), 0)
  FROM public.purchase_order_receipt_lines AS receipt_line
  JOIN public.purchase_order_receipts AS receipt
    ON receipt.id = receipt_line.receipt_id
  WHERE receipt.purchase_order_id = p_order_id;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_document(
  p_revision_id uuid,
  p_replayed boolean
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_revision public.purchase_order_revisions;
  v_order public.purchase_orders;
BEGIN
  SELECT * INTO v_revision
  FROM public.purchase_order_revisions
  WHERE id = p_revision_id;

  SELECT * INTO v_order
  FROM public.purchase_orders
  WHERE id = v_revision.purchase_order_id;

  RETURN jsonb_build_object(
    'purchaseOrderId', v_order.id,
    'revisionId', v_revision.id,
    'poNumber', v_order.po_number,
    'revisionNumber', v_revision.revision_number,
    'status', v_order.status,
    'state', v_revision.state,
    'goodsExVat', v_revision.goods_ex_vat,
    'deliveryExVat', v_revision.delivery_ex_vat,
    'subtotalExVat', v_revision.subtotal_ex_vat,
    'vatTotal', v_revision.vat_total,
    'totalIncVat', v_revision.total_inc_vat,
    'replayed', p_replayed
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_refresh_status(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.purchase_orders;
  v_ordered numeric(14,4);
  v_received numeric(14,4);
  v_status text;
BEGIN
  SELECT * INTO v_order
  FROM public.purchase_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.status = 'cancelled' OR v_order.current_issued_revision_id IS NULL THEN
    RETURN v_order.status;
  END IF;

  SELECT coalesce(sum(line.quantity), 0)
  INTO v_ordered
  FROM public.purchase_order_lines AS line
  WHERE line.revision_id = v_order.current_issued_revision_id;

  SELECT coalesce(sum(receipt_line.quantity_received), 0)
  INTO v_received
  FROM public.purchase_order_receipt_lines AS receipt_line
  JOIN public.purchase_order_lines AS line
    ON line.id = receipt_line.line_id
  WHERE line.revision_id = v_order.current_issued_revision_id;

  IF v_received > v_ordered THEN
    RAISE EXCEPTION 'Received quantity exceeds the purchase order'
      USING ERRCODE = '23514';
  ELSIF v_received = 0 THEN
    v_status := 'issued';
  ELSIF v_received = v_ordered THEN
    v_status := 'received';
  ELSE
    v_status := 'partially_received';
  END IF;

  IF v_order.status IS DISTINCT FROM v_status THEN
    UPDATE public.purchase_orders
    SET status = v_status
    WHERE id = p_order_id;
  END IF;

  RETURN v_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_recalculate_draft(
  p_revision_id uuid,
  p_final boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_revision public.purchase_order_revisions;
  v_line public.purchase_order_lines;
  v_total numeric(12,2);
  v_allocated numeric(14,4);
  v_cost_sum numeric(12,2);
  v_remainder numeric(12,2);
  v_winner uuid;
  v_goods numeric(12,2);
  v_charge numeric(12,2);
  v_weight_total numeric(12,2);
  v_delivery_sum numeric(12,2);
  v_rate numeric;
  v_vat numeric(12,2) := 0;
  v_mixed boolean;
  v_group record;
BEGIN
  PERFORM public.purchase_order_require_write();

  SELECT * INTO v_revision
  FROM public.purchase_order_revisions
  WHERE id = p_revision_id
  FOR UPDATE;

  IF NOT FOUND OR v_revision.state IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Only a draft revision can be recalculated'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.purchase_order_lock_lines(p_revision_id);
  v_charge := v_revision.delivery_charge_ex_vat;

  FOR v_line IN
    SELECT *
    FROM public.purchase_order_lines
    WHERE revision_id = p_revision_id
    ORDER BY line_number
  LOOP
    v_total := round(v_line.quantity * v_line.unit_price_ex_vat, 2);
    IF v_total <= 0 OR v_total > 9999999999.99 THEN
      RAISE EXCEPTION 'Line % rounds to an amount that cannot be ordered', v_line.line_number
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.purchase_order_lines
    SET line_total_ex_vat = v_total
    WHERE id = v_line.id;

    SELECT coalesce(sum(quantity), 0)
    INTO v_allocated
    FROM public.purchase_order_allocations
    WHERE line_id = v_line.id;

    IF v_allocated > v_line.quantity
      OR (p_final AND v_allocated IS DISTINCT FROM v_line.quantity) THEN
      RAISE EXCEPTION 'Line % is not fully allocated', v_line.line_number
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.purchase_order_allocations AS allocation
    SET cost_ex_vat = round(v_total * allocation.quantity / v_line.quantity, 2)
    WHERE allocation.line_id = v_line.id;

    IF v_allocated = v_line.quantity THEN
      SELECT coalesce(sum(cost_ex_vat), 0)
      INTO v_cost_sum
      FROM public.purchase_order_allocations
      WHERE line_id = v_line.id;

      v_remainder := v_total - v_cost_sum;
      IF v_remainder <> 0 THEN
        SELECT allocation.id
        INTO v_winner
        FROM public.purchase_order_allocations AS allocation
        LEFT JOIN public.jobs AS job
          ON job.id = allocation.job_id
        WHERE allocation.line_id = v_line.id
        ORDER BY
          allocation.quantity DESC,
          CASE WHEN allocation.target = 'stock' THEN 1 ELSE 0 END,
          job.job_reference ASC NULLS LAST,
          allocation.id ASC
        LIMIT 1;

        UPDATE public.purchase_order_allocations
        SET cost_ex_vat = cost_ex_vat + v_remainder
        WHERE id = v_winner
          AND cost_ex_vat + v_remainder >= 0;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Purchase order rounding could not be balanced'
            USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;
  END LOOP;

  SELECT coalesce(sum(line_total_ex_vat), 0)::numeric(12,2)
  INTO v_goods
  FROM public.purchase_order_lines
  WHERE revision_id = p_revision_id;

  IF v_charge = 0 OR v_revision.delivery_charge_method = 'proportional' THEN
    DELETE FROM public.purchase_order_charge_allocations
    WHERE revision_id = p_revision_id;
  END IF;

  IF v_revision.delivery_charge_method = 'proportional' AND v_charge > 0 THEN
    SELECT coalesce(sum(bucket.weight), 0)
    INTO v_weight_total
    FROM (
      SELECT sum(allocation.cost_ex_vat) AS weight
      FROM public.purchase_order_allocations AS allocation
      JOIN public.purchase_order_lines AS line
        ON line.id = allocation.line_id
      WHERE line.revision_id = p_revision_id
      GROUP BY allocation.target, allocation.job_id
      HAVING sum(allocation.cost_ex_vat) > 0
    ) AS bucket;

    IF v_weight_total = 0 THEN
      IF p_final THEN
        RAISE EXCEPTION 'Delivery cannot be allocated because the goods have no value'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      INSERT INTO public.purchase_order_charge_allocations (
        revision_id, target, job_id, amount_ex_vat, method
      )
      SELECT
        p_revision_id,
        bucket.target,
        bucket.job_id,
        round(v_charge * bucket.weight / v_weight_total, 2),
        'proportional'
      FROM (
        SELECT
          allocation.target,
          allocation.job_id,
          sum(allocation.cost_ex_vat) AS weight
        FROM public.purchase_order_allocations AS allocation
        JOIN public.purchase_order_lines AS line
          ON line.id = allocation.line_id
        WHERE line.revision_id = p_revision_id
        GROUP BY allocation.target, allocation.job_id
        HAVING sum(allocation.cost_ex_vat) > 0
      ) AS bucket;

      SELECT coalesce(sum(amount_ex_vat), 0)
      INTO v_delivery_sum
      FROM public.purchase_order_charge_allocations
      WHERE revision_id = p_revision_id;

      v_remainder := v_charge - v_delivery_sum;
      IF v_remainder <> 0 THEN
        SELECT charge.id
        INTO v_winner
        FROM public.purchase_order_charge_allocations AS charge
        JOIN (
          SELECT
            allocation.target,
            allocation.job_id,
            sum(allocation.cost_ex_vat) AS weight
          FROM public.purchase_order_allocations AS allocation
          JOIN public.purchase_order_lines AS line
            ON line.id = allocation.line_id
          WHERE line.revision_id = p_revision_id
          GROUP BY allocation.target, allocation.job_id
        ) AS bucket
          ON bucket.target = charge.target
         AND bucket.job_id IS NOT DISTINCT FROM charge.job_id
        LEFT JOIN public.jobs AS job
          ON job.id = charge.job_id
        WHERE charge.revision_id = p_revision_id
        ORDER BY
          bucket.weight DESC,
          CASE WHEN charge.target = 'stock' THEN 1 ELSE 0 END,
          job.job_reference ASC NULLS LAST,
          charge.id ASC
        LIMIT 1;

        UPDATE public.purchase_order_charge_allocations
        SET amount_ex_vat = amount_ex_vat + v_remainder
        WHERE id = v_winner
          AND amount_ex_vat + v_remainder >= 0;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Delivery rounding could not be balanced'
            USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.purchase_order_charge_allocations AS charge
    WHERE charge.revision_id = p_revision_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.purchase_order_allocations AS allocation
        JOIN public.purchase_order_lines AS line
          ON line.id = allocation.line_id
        WHERE line.revision_id = p_revision_id
          AND allocation.target = charge.target
          AND allocation.job_id IS NOT DISTINCT FROM charge.job_id
      )
  ) THEN
    RAISE EXCEPTION 'Delivery can only be allocated to jobs or stock that are receiving goods'
      USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(sum(amount_ex_vat), 0)
  INTO v_delivery_sum
  FROM public.purchase_order_charge_allocations
  WHERE revision_id = p_revision_id;

  IF p_final AND v_delivery_sum IS DISTINCT FROM v_charge THEN
    RAISE EXCEPTION 'Delivery allocations must equal the delivery charge'
      USING ERRCODE = '23514';
  END IF;

  v_rate := public.purchase_order_standard_vat_rate();
  v_mixed := EXISTS (
    SELECT 1
    FROM public.purchase_order_lines
    WHERE revision_id = p_revision_id
      AND vat_treatment IS NOT NULL
      AND vat_treatment IS DISTINCT FROM v_revision.vat_treatment
  );

  IF NOT v_mixed THEN
    v_vat := public.purchase_order_vat_amount(
      v_revision.vat_treatment,
      v_goods + v_charge,
      v_rate
    );
  ELSE
    FOR v_group IN
      SELECT
        coalesce(line.vat_treatment, v_revision.vat_treatment) AS treatment,
        sum(line.line_total_ex_vat) AS net
      FROM public.purchase_order_lines AS line
      WHERE line.revision_id = p_revision_id
      GROUP BY 1
    LOOP
      v_vat := v_vat + public.purchase_order_vat_amount(v_group.treatment, v_group.net, v_rate);
    END LOOP;

    v_vat := v_vat + public.purchase_order_vat_amount(
      v_revision.vat_treatment,
      v_charge,
      v_rate
    );
  END IF;

  IF v_goods + v_charge > 9999999999.99
    OR v_goods + v_charge + v_vat > 9999999999.99 THEN
    RAISE EXCEPTION 'Purchase order total is too large'
      USING ERRCODE = '22003';
  END IF;

  UPDATE public.purchase_order_revisions
  SET
    goods_ex_vat = v_goods,
    delivery_ex_vat = v_charge,
    subtotal_ex_vat = v_goods + v_charge,
    vat_rate = v_rate,
    vat_total = v_vat,
    total_inc_vat = v_goods + v_charge + v_vat
  WHERE id = p_revision_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_assert_issueable(p_revision_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_supplier_id uuid;
  v_line record;
BEGIN
  SELECT purchase_order.supplier_id
  INTO v_supplier_id
  FROM public.purchase_order_revisions AS revision
  JOIN public.purchase_orders AS purchase_order
    ON purchase_order.id = revision.purchase_order_id
  WHERE revision.id = p_revision_id;

  FOR v_line IN
    SELECT
      line.line_number,
      line.line_kind,
      line.material_id,
      line.material_supplier_product_id,
      line.material_price_id,
      line.unit,
      line.unit_price_ex_vat,
      price.price,
      price.currency,
      price.price_unit,
      price.material_supplier_product_id AS price_product_id,
      product.material_id AS product_material_id,
      product.supplier_id AS product_supplier_id,
      product.active AS product_active,
      material.active AS material_active,
      supplier.active AS supplier_active
    FROM public.purchase_order_lines AS line
    LEFT JOIN public.material_prices AS price
      ON price.id = line.material_price_id
    LEFT JOIN public.material_supplier_products AS product
      ON product.id = line.material_supplier_product_id
    LEFT JOIN public.materials AS material
      ON material.id = line.material_id
    LEFT JOIN public.suppliers AS supplier
      ON supplier.id = product.supplier_id
    WHERE line.revision_id = p_revision_id
  LOOP
    IF v_line.line_kind = 'catalogue' AND (
      NOT coalesce(v_line.material_active, false)
      OR NOT coalesce(v_line.product_active, false)
      OR NOT coalesce(v_line.supplier_active, false)
      OR v_line.price_product_id IS DISTINCT FROM v_line.material_supplier_product_id
      OR v_line.product_material_id IS DISTINCT FROM v_line.material_id
      OR v_line.product_supplier_id IS DISTINCT FROM v_supplier_id
      OR v_line.currency IS DISTINCT FROM 'GBP'
      OR v_line.unit IS DISTINCT FROM v_line.price_unit
      OR v_line.unit_price_ex_vat IS DISTINCT FROM round(v_line.price, 4)
    ) THEN
      RAISE EXCEPTION 'Line % no longer matches an active approved catalogue price', v_line.line_number
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.purchase_order_allocations AS allocation
    JOIN public.purchase_order_lines AS line
      ON line.id = allocation.line_id
    JOIN public.jobs AS job
      ON job.id = allocation.job_id
    WHERE line.revision_id = p_revision_id
      AND job.status = 'cancelled'
  ) OR EXISTS (
    SELECT 1
    FROM public.purchase_order_charge_allocations AS charge
    JOIN public.jobs AS job
      ON job.id = charge.job_id
    WHERE charge.revision_id = p_revision_id
      AND job.status = 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Cancelled jobs cannot receive a purchase allocation'
      USING ERRCODE = '23514';
  END IF;

END;
$$;

-- ---------------------------------------------------------------------------
-- Drafts. Saving replaces the draft's lines and allocations.
-- Catalogue descriptions, units and prices are copied from the database.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_purchase_order_issuer(
  p_profile_id uuid,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Only an approved admin can assign purchase order issuing'
      USING ERRCODE = '42501';
  END IF;

  IF p_profile_id IS NULL OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'Profile and enabled flag are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT user_role
  INTO v_role
  FROM public.profiles
  WHERE id = p_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff profile was not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_role IS DISTINCT FROM 'production' THEN
    RAISE EXCEPTION 'Only production staff can be assigned purchase order issuing'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.profiles
  SET can_issue_purchase_orders = p_enabled
  WHERE id = p_profile_id
    AND user_role = 'production';

  RETURN jsonb_build_object(
    'profileId', p_profile_id,
    'canIssuePurchaseOrders', p_enabled
  );
END;
$$;

-- Direct profile updates may change every other column the caller can update.
-- A requested change to the issuing flag is allowed only when the statement is
-- running as the owner of set_purchase_order_issuer. That is the security-definer
-- identity of the authorised function. The trigger stays security invoker so
-- current_user is the statement identity. A session variable is not used: any
-- caller can set one, including candid.po_write.
-- Inserts cannot enable purchasing. The column default is false, and true is
-- rejected for every role. An approved admin enables it afterwards.
-- Service-role staff maintenance may change user_role. Leaving production clears
-- the flag in that statement so the role check does not reject the update.
CREATE OR REPLACE FUNCTION public.profiles_guard_purchase_order_issuer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_owner name;
  v_actor name;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.can_issue_purchase_orders IS TRUE THEN
      RAISE EXCEPTION 'Purchase order issuing can only be changed by an approved admin'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.can_issue_purchase_orders IS NOT DISTINCT FROM OLD.can_issue_purchase_orders
     AND (
       NEW.user_role IS NOT DISTINCT FROM 'production'
       OR OLD.can_issue_purchase_orders IS NOT TRUE
     ) THEN
    RETURN NEW;
  END IF;

  v_actor := CURRENT_USER;

  SELECT pg_catalog.pg_get_userbyid(proc.proowner)
  INTO v_owner
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'set_purchase_order_issuer'
    AND proc.pronargs = 2
    AND proc.prosecdef
  ORDER BY proc.oid
  LIMIT 1;

  IF NEW.user_role IS DISTINCT FROM 'production'
     AND OLD.can_issue_purchase_orders IS TRUE
     AND NEW.can_issue_purchase_orders IS NOT DISTINCT FROM OLD.can_issue_purchase_orders
     AND (
       v_actor = 'service_role'
       OR (v_owner IS NOT NULL AND v_actor = v_owner)
     ) THEN
    NEW.can_issue_purchase_orders := false;
    RETURN NEW;
  END IF;

  IF NEW.can_issue_purchase_orders IS NOT DISTINCT FROM OLD.can_issue_purchase_orders THEN
    RETURN NEW;
  END IF;

  IF v_owner IS NULL OR v_actor IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Purchase order issuing can only be changed by an approved admin'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_purchase_order_issuer ON public.profiles;
CREATE TRIGGER profiles_guard_purchase_order_issuer
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_purchase_order_issuer();

CREATE OR REPLACE FUNCTION public.create_purchase_order(p_supplier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_name text;
  v_active boolean;
  v_email text;
  v_order public.purchase_orders;
  v_revision public.purchase_order_revisions;
  v_rate numeric;
BEGIN
  PERFORM public.purchase_order_require_purchaser();
  PERFORM public.purchase_order_begin_write();

  SELECT name, active, orders_email
  INTO v_name, v_active, v_email
  FROM public.suppliers
  WHERE id = p_supplier_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier was not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_active THEN
    RAISE EXCEPTION 'Supplier is not active'
      USING ERRCODE = '23514';
  END IF;

  v_rate := public.purchase_order_standard_vat_rate();

  INSERT INTO public.purchase_orders (supplier_id, status, created_by)
  VALUES (p_supplier_id, 'draft', auth.uid())
  RETURNING * INTO v_order;

  INSERT INTO public.purchase_order_revisions (
    purchase_order_id,
    revision_number,
    state,
    supplier_name,
    supplier_orders_email,
    currency,
    vat_treatment,
    vat_rate,
    delivery_method,
    delivery_country,
    delivery_charge_ex_vat,
    delivery_charge_method,
    goods_ex_vat,
    delivery_ex_vat,
    subtotal_ex_vat,
    vat_total,
    total_inc_vat
  )
  VALUES (
    v_order.id,
    1,
    'draft',
    v_name,
    v_email,
    'GBP',
    'standard',
    v_rate,
    'workshop',
    'United Kingdom',
    0,
    'proportional',
    0,
    0,
    0,
    0,
    0
  )
  RETURNING * INTO v_revision;

  UPDATE public.purchase_orders
  SET current_draft_revision_id = v_revision.id
  WHERE id = v_order.id;

  PERFORM public.purchase_order_event(
    v_order.id,
    v_revision.id,
    NULL,
    'draft_created',
    jsonb_build_object('supplierId', p_supplier_id)
  );
  PERFORM public.purchase_order_assert_pointers(v_order.id);

  RETURN public.purchase_order_document(v_revision.id, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.save_purchase_order_draft(
  p_revision_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.purchase_orders;
  v_revision public.purchase_order_revisions;
  v_order_id uuid;
  v_required text[] := ARRAY[
    'supplierOrdersEmail', 'vatTreatment', 'deliveryMethod', 'deliveryRecipient',
    'deliveryLine1', 'deliveryLine2', 'deliveryCity', 'deliveryCounty',
    'deliveryPostcode', 'deliveryCountry', 'deliveryInstructions', 'deliveryDate',
    'deliveryChargeExVat', 'deliveryChargeMethod', 'lines', 'deliveryAllocations'
  ];
  v_line_keys text[] := ARRAY[
    'lineKind', 'materialId', 'productId', 'priceId', 'description', 'supplierSku',
    'unit', 'quantity', 'unitPriceExVat', 'vatTreatment', 'allocations'
  ];
  v_allocation_keys text[] := ARRAY['target', 'jobId', 'quantity'];
  v_delivery_keys text[] := ARRAY['target', 'jobId', 'amountExVat'];
  v_key text;
  v_email text;
  v_vat_treatment text;
  v_delivery_method text;
  v_charge_method text;
  v_charge numeric(12,2);
  v_supplier_name text;
  v_supplier_active boolean;
  v_recipient text;
  v_line_1 text;
  v_line_2 text;
  v_city text;
  v_county text;
  v_postcode text;
  v_country text;
  v_instructions text;
  v_delivery_date date;
  v_line jsonb;
  v_allocation jsonb;
  v_delivery jsonb;
  v_line_number integer := 0;
  v_line_id uuid;
  v_kind text;
  v_material_id uuid;
  v_product_id uuid;
  v_price_id uuid;
  v_quantity numeric(14,4);
  v_unit_price numeric(14,4);
  v_description text;
  v_sku text;
  v_unit text;
  v_line_vat text;
  v_line_total numeric(12,2);
  v_seen text[];
  v_token text;
  v_target text;
  v_job_id uuid;
  v_job_status text;
  v_alloc_qty numeric(14,4);
  v_amount numeric(12,2);
  v_previous jsonb;
  v_current jsonb;
  v_catalogue record;
BEGIN
  PERFORM public.purchase_order_require_purchaser();
  PERFORM public.purchase_order_begin_write();
  PERFORM public.purchase_order_assert_keys(p_payload, v_required);

  FOREACH v_key IN ARRAY v_required LOOP
    IF NOT p_payload ? v_key THEN
      RAISE EXCEPTION 'Purchase order field is required: %', v_key
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF jsonb_typeof(p_payload->'vatTreatment') <> 'string'
    OR (p_payload->>'vatTreatment') NOT IN (
      'standard', 'zero_rated', 'exempt', 'reverse_charge', 'outside_scope'
    ) THEN
    RAISE EXCEPTION 'VAT treatment is not supported'
      USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(p_payload->'deliveryMethod') <> 'string'
    OR (p_payload->>'deliveryMethod') NOT IN ('workshop', 'custom') THEN
    RAISE EXCEPTION 'Delivery method is not supported'
      USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(p_payload->'deliveryChargeMethod') <> 'string'
    OR (p_payload->>'deliveryChargeMethod') NOT IN ('proportional', 'manual') THEN
    RAISE EXCEPTION 'Delivery charge method is not supported'
      USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(p_payload->'lines') <> 'array'
    OR jsonb_typeof(p_payload->'deliveryAllocations') <> 'array' THEN
    RAISE EXCEPTION 'Purchase order lines must be arrays'
      USING ERRCODE = '22023';
  END IF;

  v_vat_treatment := p_payload->>'vatTreatment';
  v_delivery_method := p_payload->>'deliveryMethod';
  v_charge_method := p_payload->>'deliveryChargeMethod';
  v_charge := public.purchase_order_numeric(p_payload->'deliveryChargeExVat', 'deliveryChargeExVat', 2);
  v_email := public.purchase_order_optional_text(p_payload, 'supplierOrdersEmail', 320);
  v_recipient := public.purchase_order_optional_text(p_payload, 'deliveryRecipient', 200);
  v_line_1 := public.purchase_order_optional_text(p_payload, 'deliveryLine1', 200);
  v_line_2 := public.purchase_order_optional_text(p_payload, 'deliveryLine2', 200);
  v_city := public.purchase_order_optional_text(p_payload, 'deliveryCity', 120);
  v_county := public.purchase_order_optional_text(p_payload, 'deliveryCounty', 120);
  v_postcode := public.purchase_order_optional_text(p_payload, 'deliveryPostcode', 20);
  v_country := public.purchase_order_optional_text(p_payload, 'deliveryCountry', 80);
  v_instructions := public.purchase_order_optional_text(p_payload, 'deliveryInstructions', 2000);

  IF v_email IS NOT NULL THEN
    v_email := lower(v_email);
    IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'Supplier email is not valid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_charge < 0 THEN
    RAISE EXCEPTION 'Delivery charge cannot be negative'
      USING ERRCODE = '23514';
  END IF;

  IF v_delivery_method = 'custom' AND (v_line_1 IS NULL OR v_postcode IS NULL) THEN
    RAISE EXCEPTION 'Custom delivery needs an address line and a postcode'
      USING ERRCODE = '23514';
  END IF;

  IF v_charge_method = 'proportional' AND jsonb_array_length(p_payload->'deliveryAllocations') > 0 THEN
    RAISE EXCEPTION 'Proportional delivery is calculated by the server'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    IF jsonb_typeof(p_payload->'deliveryDate') = 'null' THEN
      v_delivery_date := NULL;
    ELSIF jsonb_typeof(p_payload->'deliveryDate') <> 'string'
      OR btrim(p_payload->>'deliveryDate') = '' THEN
      IF jsonb_typeof(p_payload->'deliveryDate') = 'string' THEN
        v_delivery_date := NULL;
      ELSE
        RAISE EXCEPTION 'deliveryDate must be a date'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      v_delivery_date := (p_payload->>'deliveryDate')::date;
    END IF;
  EXCEPTION
    WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'deliveryDate must be a date'
        USING ERRCODE = '22023';
  END;

  SELECT revision.purchase_order_id
  INTO v_order_id
  FROM public.purchase_order_revisions AS revision
  WHERE revision.id = p_revision_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order draft was not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_order
  FROM public.purchase_orders
  WHERE id = v_order_id
  FOR UPDATE;

  SELECT * INTO v_revision
  FROM public.purchase_order_revisions
  WHERE id = p_revision_id
  FOR UPDATE;

  IF v_revision.state IS DISTINCT FROM 'draft'
    OR v_order.current_draft_revision_id IS DISTINCT FROM p_revision_id THEN
    RAISE EXCEPTION 'Only the current draft can be saved'
      USING ERRCODE = '42501';
  END IF;

  SELECT name, active
  INTO v_supplier_name, v_supplier_active
  FROM public.suppliers
  WHERE id = v_order.supplier_id
  FOR SHARE;

  IF NOT FOUND OR NOT v_supplier_active THEN
    RAISE EXCEPTION 'Supplier is not active'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.purchase_order_revisions
  SET
    supplier_name = v_supplier_name,
    supplier_orders_email = v_email,
    vat_treatment = v_vat_treatment,
    delivery_method = v_delivery_method,
    delivery_recipient = CASE WHEN v_delivery_method = 'custom' THEN v_recipient ELSE NULL END,
    delivery_line_1 = CASE WHEN v_delivery_method = 'custom' THEN v_line_1 ELSE NULL END,
    delivery_line_2 = CASE WHEN v_delivery_method = 'custom' THEN v_line_2 ELSE NULL END,
    delivery_city = CASE WHEN v_delivery_method = 'custom' THEN v_city ELSE NULL END,
    delivery_county = CASE WHEN v_delivery_method = 'custom' THEN v_county ELSE NULL END,
    delivery_postcode = CASE WHEN v_delivery_method = 'custom' THEN v_postcode ELSE NULL END,
    delivery_country = coalesce(v_country, 'United Kingdom'),
    delivery_instructions = v_instructions,
    delivery_date = v_delivery_date,
    delivery_charge_ex_vat = v_charge,
    delivery_charge_method = v_charge_method,
    delivery_ex_vat = v_charge,
    subtotal_ex_vat = goods_ex_vat + v_charge,
    total_inc_vat = goods_ex_vat + v_charge + vat_total
  WHERE id = p_revision_id;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'target', charge.target,
      'jobId', charge.job_id,
      'amountExVat', charge.amount_ex_vat
    )
    ORDER BY charge.target, charge.job_id
  ), '[]'::jsonb)
  INTO v_previous
  FROM public.purchase_order_charge_allocations AS charge
  WHERE charge.revision_id = p_revision_id;

  DELETE FROM public.purchase_order_allocations AS allocation
  USING public.purchase_order_lines AS line
  WHERE allocation.line_id = line.id
    AND line.revision_id = p_revision_id;

  DELETE FROM public.purchase_order_charge_allocations
  WHERE revision_id = p_revision_id;

  DELETE FROM public.purchase_order_lines
  WHERE revision_id = p_revision_id;

  FOR v_line IN
    SELECT value
    FROM jsonb_array_elements(p_payload->'lines')
  LOOP
    PERFORM public.purchase_order_assert_keys(v_line, v_line_keys);
    v_line_number := v_line_number + 1;
    v_seen := '{}';

    IF jsonb_typeof(v_line->'lineKind') <> 'string'
      OR (v_line->>'lineKind') NOT IN ('catalogue', 'manual') THEN
      RAISE EXCEPTION 'Line % kind is not supported', v_line_number
        USING ERRCODE = '23514';
    END IF;

    v_kind := v_line->>'lineKind';
    v_quantity := public.purchase_order_numeric(v_line->'quantity', 'quantity', 4);
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'Line % quantity must be greater than zero', v_line_number
        USING ERRCODE = '23514';
    END IF;

    v_line_vat := public.purchase_order_optional_text(v_line, 'vatTreatment', 40);
    IF v_line_vat IS NOT NULL AND v_line_vat NOT IN (
      'standard', 'zero_rated', 'exempt', 'reverse_charge', 'outside_scope'
    ) THEN
      RAISE EXCEPTION 'Line % VAT treatment is not supported', v_line_number
        USING ERRCODE = '23514';
    END IF;

    IF v_line_vat IS NOT DISTINCT FROM v_vat_treatment THEN
      v_line_vat := NULL;
    END IF;

    IF v_kind = 'catalogue' THEN
      v_material_id := public.purchase_order_uuid(v_line->'materialId', 'materialId');
      v_product_id := public.purchase_order_uuid(v_line->'productId', 'productId');
      v_price_id := public.purchase_order_uuid(v_line->'priceId', 'priceId');
      IF v_material_id IS NULL OR v_product_id IS NULL OR v_price_id IS NULL THEN
        RAISE EXCEPTION 'Catalogue line % needs a material, product and price', v_line_number
          USING ERRCODE = '23514';
      END IF;

      SELECT
        price.price,
        product.supplier_sku,
        product.supplier_description,
        material.purchase_unit
      INTO v_catalogue
      FROM public.material_prices AS price
      JOIN public.material_supplier_products AS product
        ON product.id = price.material_supplier_product_id
      JOIN public.materials AS material
        ON material.id = product.material_id
      WHERE price.id = v_price_id
        AND product.id = v_product_id
        AND material.id = v_material_id
        AND product.supplier_id = v_order.supplier_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Line % does not match this supplier catalogue', v_line_number
          USING ERRCODE = '23514';
      END IF;

      v_unit_price := round(v_catalogue.price, 4);
      v_description := v_catalogue.supplier_description;
      v_sku := v_catalogue.supplier_sku;
      v_unit := v_catalogue.purchase_unit;
    ELSE
      IF public.purchase_order_uuid(v_line->'materialId', 'materialId') IS NOT NULL
        OR public.purchase_order_uuid(v_line->'productId', 'productId') IS NOT NULL
        OR public.purchase_order_uuid(v_line->'priceId', 'priceId') IS NOT NULL THEN
        RAISE EXCEPTION 'Manual line % cannot reference the catalogue', v_line_number
          USING ERRCODE = '23514';
      END IF;

      v_material_id := NULL;
      v_product_id := NULL;
      v_price_id := NULL;
      v_description := public.purchase_order_optional_text(v_line, 'description', 500);
      v_sku := public.purchase_order_optional_text(v_line, 'supplierSku', 200);
      v_unit := public.purchase_order_optional_text(v_line, 'unit', 40);
      v_unit_price := public.purchase_order_numeric(v_line->'unitPriceExVat', 'unitPriceExVat', 4);
      IF v_description IS NULL OR v_unit IS NULL OR v_unit_price <= 0 THEN
        RAISE EXCEPTION 'Manual line % needs a description, unit and price', v_line_number
          USING ERRCODE = '23514';
      END IF;
    END IF;

    v_line_total := round(v_quantity * v_unit_price, 2);
    IF v_line_total <= 0 THEN
      RAISE EXCEPTION 'Line % rounds to zero', v_line_number
        USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.purchase_order_lines (
      revision_id,
      line_number,
      line_kind,
      material_id,
      material_supplier_product_id,
      material_price_id,
      description,
      supplier_sku,
      unit,
      quantity,
      unit_price_ex_vat,
      line_total_ex_vat,
      vat_treatment
    )
    VALUES (
      p_revision_id,
      v_line_number,
      v_kind,
      v_material_id,
      v_product_id,
      v_price_id,
      v_description,
      v_sku,
      v_unit,
      v_quantity,
      v_unit_price,
      v_line_total,
      v_line_vat
    )
    RETURNING id INTO v_line_id;

    IF jsonb_typeof(v_line->'allocations') <> 'array' THEN
      RAISE EXCEPTION 'Line % allocations must be an array', v_line_number
        USING ERRCODE = '22023';
    END IF;

    FOR v_allocation IN
      SELECT value
      FROM jsonb_array_elements(v_line->'allocations')
    LOOP
      PERFORM public.purchase_order_assert_keys(v_allocation, v_allocation_keys);
      v_target := v_allocation->>'target';
      v_job_id := public.purchase_order_uuid(v_allocation->'jobId', 'jobId');
      v_alloc_qty := public.purchase_order_numeric(v_allocation->'quantity', 'quantity', 4);

      IF v_target = 'job' THEN
        IF v_job_id IS NULL THEN
          RAISE EXCEPTION 'Line % job allocation needs a job', v_line_number
            USING ERRCODE = '23514';
        END IF;
        SELECT status INTO v_job_status
        FROM public.jobs
        WHERE id = v_job_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Job was not found'
            USING ERRCODE = 'P0002';
        END IF;
        IF v_job_status = 'cancelled' THEN
          RAISE EXCEPTION 'Cancelled jobs cannot receive a purchase allocation'
            USING ERRCODE = '23514';
        END IF;
        v_token := v_job_id::text;
      ELSIF v_target = 'stock' THEN
        IF v_job_id IS NOT NULL THEN
          RAISE EXCEPTION 'Stock allocation cannot reference a job'
            USING ERRCODE = '23514';
        END IF;
        v_token := 'stock';
      ELSE
        RAISE EXCEPTION 'Allocation target is not supported'
          USING ERRCODE = '23514';
      END IF;

      IF v_alloc_qty <= 0 THEN
        RAISE EXCEPTION 'Allocation quantity must be greater than zero'
          USING ERRCODE = '23514';
      END IF;

      IF v_token = ANY (v_seen) THEN
        RAISE EXCEPTION 'Line % repeats an allocation target', v_line_number
          USING ERRCODE = '23514';
      END IF;
      v_seen := array_append(v_seen, v_token);

      INSERT INTO public.purchase_order_allocations (
        line_id, target, job_id, quantity, cost_ex_vat
      )
      VALUES (v_line_id, v_target, v_job_id, v_alloc_qty, 0);
    END LOOP;
  END LOOP;

  v_seen := '{}';
  IF v_charge_method = 'manual' THEN
    FOR v_delivery IN
      SELECT value
      FROM jsonb_array_elements(p_payload->'deliveryAllocations')
    LOOP
      PERFORM public.purchase_order_assert_keys(v_delivery, v_delivery_keys);
      v_target := v_delivery->>'target';
      v_job_id := public.purchase_order_uuid(v_delivery->'jobId', 'jobId');
      v_amount := public.purchase_order_numeric(v_delivery->'amountExVat', 'amountExVat', 2);
      IF v_amount < 0 THEN
        RAISE EXCEPTION 'Delivery allocation cannot be negative'
          USING ERRCODE = '23514';
      END IF;

      IF v_target = 'job' THEN
        IF v_job_id IS NULL THEN
          RAISE EXCEPTION 'Delivery allocation needs a job'
            USING ERRCODE = '23514';
        END IF;
        v_token := v_job_id::text;
      ELSIF v_target = 'stock' THEN
        IF v_job_id IS NOT NULL THEN
          RAISE EXCEPTION 'Stock delivery cannot reference a job'
            USING ERRCODE = '23514';
        END IF;
        v_token := 'stock';
      ELSE
        RAISE EXCEPTION 'Delivery allocation target is not supported'
          USING ERRCODE = '23514';
      END IF;

      IF v_token = ANY (v_seen) THEN
        RAISE EXCEPTION 'Delivery allocation repeats a target'
          USING ERRCODE = '23514';
      END IF;
      v_seen := array_append(v_seen, v_token);

      INSERT INTO public.purchase_order_charge_allocations (
        revision_id, target, job_id, amount_ex_vat, method
      )
      VALUES (p_revision_id, v_target, v_job_id, v_amount, 'manual');
    END LOOP;
  END IF;

  PERFORM public.purchase_order_recalculate_draft(p_revision_id, false);

  IF v_charge_method = 'manual' THEN
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'target', charge.target,
        'jobId', charge.job_id,
        'amountExVat', charge.amount_ex_vat
      )
      ORDER BY charge.target, charge.job_id
    ), '[]'::jsonb)
    INTO v_current
    FROM public.purchase_order_charge_allocations AS charge
    WHERE charge.revision_id = p_revision_id;

    IF v_current IS DISTINCT FROM v_previous THEN
      PERFORM public.purchase_order_event(
        v_order.id,
        p_revision_id,
        NULL,
        'delivery_allocation_overridden',
        jsonb_build_object('previous', v_previous, 'current', v_current)
      );
    END IF;
  END IF;

  PERFORM public.purchase_order_event(
    v_order.id,
    p_revision_id,
    NULL,
    'draft_saved',
    jsonb_build_object('lineCount', v_line_number)
  );
  PERFORM public.purchase_order_assert_pointers(v_order.id);

  RETURN public.purchase_order_document(p_revision_id, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_purchase_order_draft(p_revision_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.purchase_orders;
  v_revision public.purchase_order_revisions;
  v_order_id uuid;
  v_has_other boolean;
BEGIN
  PERFORM public.purchase_order_require_purchaser();
  PERFORM public.purchase_order_begin_write();

  SELECT revision.purchase_order_id
  INTO v_order_id
  FROM public.purchase_order_revisions AS revision
  WHERE revision.id = p_revision_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order draft was not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_order
  FROM public.purchase_orders
  WHERE id = v_order_id
  FOR UPDATE;

  SELECT * INTO v_revision
  FROM public.purchase_order_revisions
  WHERE id = p_revision_id
  FOR UPDATE;

  IF v_revision.state IS DISTINCT FROM 'draft'
    OR v_order.current_draft_revision_id IS DISTINCT FROM p_revision_id THEN
    RAISE EXCEPTION 'Only the current draft can be deleted'
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.purchase_order_revisions
    WHERE purchase_order_id = v_order.id
      AND id <> p_revision_id
  )
  INTO v_has_other;

  UPDATE public.purchase_orders
  SET current_draft_revision_id = NULL
  WHERE id = v_order.id;

  DELETE FROM public.purchase_order_allocations AS allocation
  USING public.purchase_order_lines AS line
  WHERE allocation.line_id = line.id
    AND line.revision_id = p_revision_id;

  DELETE FROM public.purchase_order_charge_allocations
  WHERE revision_id = p_revision_id;

  DELETE FROM public.purchase_order_lines
  WHERE revision_id = p_revision_id;

  IF v_has_other THEN
    DELETE FROM public.purchase_order_events
    WHERE revision_id = p_revision_id;

    DELETE FROM public.purchase_order_revisions
    WHERE id = p_revision_id;

    PERFORM public.purchase_order_event(
      v_order.id,
      NULL,
      NULL,
      'draft_deleted',
      jsonb_build_object('revisionId', p_revision_id)
    );
    PERFORM public.purchase_order_assert_pointers(v_order.id);

    RETURN jsonb_build_object(
      'deletedOrder', false,
      'purchaseOrderId', v_order.id
    );
  END IF;

  DELETE FROM public.purchase_order_events
  WHERE purchase_order_id = v_order.id;

  DELETE FROM public.purchase_order_revisions
  WHERE id = p_revision_id;

  DELETE FROM public.purchase_orders
  WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'deletedOrder', true,
    'purchaseOrderId', v_order.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_purchase_order_prices(p_revision_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.purchase_orders;
  v_revision public.purchase_order_revisions;
  v_order_id uuid;
  v_line public.purchase_order_lines;
  v_price record;
  v_changed boolean := false;
  v_total numeric(12,2);
BEGIN
  PERFORM public.purchase_order_require_purchaser();
  PERFORM public.purchase_order_begin_write();

  SELECT revision.purchase_order_id
  INTO v_order_id
  FROM public.purchase_order_revisions AS revision
  WHERE revision.id = p_revision_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order draft was not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_order
  FROM public.purchase_orders
  WHERE id = v_order_id
  FOR UPDATE;

  SELECT * INTO v_revision
  FROM public.purchase_order_revisions
  WHERE id = p_revision_id
  FOR UPDATE;

  IF v_revision.state IS DISTINCT FROM 'draft'
    OR v_order.current_draft_revision_id IS DISTINCT FROM p_revision_id THEN
    RAISE EXCEPTION 'Only the current draft can refresh prices'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.purchase_order_lock_lines(p_revision_id);

  FOR v_line IN
    SELECT *
    FROM public.purchase_order_lines
    WHERE revision_id = p_revision_id
      AND line_kind = 'catalogue'
    ORDER BY id
  LOOP
    SELECT
      price.id,
      price.price,
      product.supplier_sku,
      product.supplier_description,
      material.purchase_unit
    INTO v_price
    FROM public.material_prices AS price
    JOIN public.material_supplier_products AS product
      ON product.id = price.material_supplier_product_id
    JOIN public.materials AS material
      ON material.id = product.material_id
    WHERE price.material_supplier_product_id = v_line.material_supplier_product_id
    ORDER BY price.effective_date DESC, price.approved_at DESC, price.created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'This product has no current approved price'
        USING ERRCODE = '23514';
    END IF;

    IF v_price.price IS DISTINCT FROM round(v_price.price, 4) OR v_price.price <= 0 THEN
      RAISE EXCEPTION 'The current approved price cannot be used on a purchase order'
        USING ERRCODE = '23514';
    END IF;

    v_total := round(v_line.quantity * round(v_price.price, 4), 2);
    IF v_total <= 0 THEN
      RAISE EXCEPTION 'Refreshing the price rounds line % to zero', v_line.line_number
        USING ERRCODE = '23514';
    END IF;

    IF v_line.material_price_id IS DISTINCT FROM v_price.id
      OR v_line.unit_price_ex_vat IS DISTINCT FROM round(v_price.price, 4)
      OR v_line.description IS DISTINCT FROM v_price.supplier_description
      OR v_line.supplier_sku IS DISTINCT FROM v_price.supplier_sku
      OR v_line.unit IS DISTINCT FROM v_price.purchase_unit THEN
      UPDATE public.purchase_order_lines
      SET
        material_price_id = v_price.id,
        unit_price_ex_vat = round(v_price.price, 4),
        description = v_price.supplier_description,
        supplier_sku = v_price.supplier_sku,
        unit = v_price.purchase_unit,
        line_total_ex_vat = v_total
      WHERE id = v_line.id;
      v_changed := true;
    END IF;
  END LOOP;

  PERFORM public.purchase_order_recalculate_draft(p_revision_id, false);

  IF v_changed THEN
    PERFORM public.purchase_order_event(
      v_order.id,
      p_revision_id,
      NULL,
      'prices_refreshed',
      '{}'::jsonb
    );
  END IF;

  PERFORM public.purchase_order_assert_pointers(v_order.id);
  RETURN public.purchase_order_document(p_revision_id, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_purchase_order(
  p_order_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.purchase_orders;
  v_revision public.purchase_order_revisions;
  v_existing public.purchase_order_revisions;
  v_key text;
  v_supplier_name text;
  v_supplier_active boolean;
  v_number integer;
  v_line_count integer;
BEGIN
  PERFORM public.purchase_order_require_purchaser();
  PERFORM public.purchase_order_begin_write();

  v_key := btrim(coalesce(p_idempotency_key, ''));
  IF v_key = '' OR char_length(v_key) > 200 THEN
    RAISE EXCEPTION 'Idempotency key is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order
  FROM public.purchase_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order was not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_existing
  FROM public.purchase_order_revisions
  WHERE purchase_order_id = p_order_id
    AND issue_idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    RETURN public.purchase_order_document(v_existing.id, true);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.purchase_order_revisions
    WHERE issue_idempotency_key = v_key
      AND purchase_order_id <> p_order_id
  ) THEN
    RAISE EXCEPTION 'Idempotency key was already used'
      USING ERRCODE = '40001';
  END IF;

  IF v_order.current_draft_revision_id IS NULL THEN
    IF v_order.current_issued_revision_id IS NOT NULL THEN
      RAISE EXCEPTION 'This purchase order is already issued'
        USING ERRCODE = '40001';
    END IF;
    RAISE EXCEPTION 'Purchase order draft was not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_revision
  FROM public.purchase_order_revisions
  WHERE id = v_order.current_draft_revision_id
  FOR UPDATE;

  IF v_revision.state IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Only the current draft can be issued'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.purchase_order_lock_lines(v_revision.id);

  IF public.purchase_order_received_quantity(v_order.id) <> 0 THEN
    RAISE EXCEPTION 'Received purchase orders cannot be revised'
      USING ERRCODE = '23514';
  END IF;

  SELECT name, active
  INTO v_supplier_name, v_supplier_active
  FROM public.suppliers
  WHERE id = v_order.supplier_id
  FOR SHARE;

  IF NOT FOUND OR NOT v_supplier_active THEN
    RAISE EXCEPTION 'Supplier is not active'
      USING ERRCODE = '23514';
  END IF;

  IF v_revision.supplier_orders_email IS NULL THEN
    RAISE EXCEPTION 'A supplier email is required before issuing'
      USING ERRCODE = '23514';
  END IF;

  -- Issue keeps the draft's selected price. It does not call refresh.
  IF v_revision.delivery_method = 'workshop' THEN
    UPDATE public.purchase_order_revisions AS revision
    SET
      delivery_recipient = address.recipient,
      delivery_line_1 = address.line_1,
      delivery_line_2 = address.line_2,
      delivery_city = address.city,
      delivery_county = NULL,
      delivery_postcode = address.postcode,
      delivery_country = 'United Kingdom'
    FROM public.purchase_order_workshop_address() AS address
    WHERE revision.id = v_revision.id;
  END IF;

  PERFORM public.purchase_order_recalculate_draft(v_revision.id, true);
  PERFORM public.purchase_order_assert_issueable(v_revision.id);

  SELECT * INTO v_revision
  FROM public.purchase_order_revisions
  WHERE id = v_revision.id;

  SELECT count(*) INTO v_line_count
  FROM public.purchase_order_lines
  WHERE revision_id = v_revision.id;

  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'A purchase order needs at least one line'
      USING ERRCODE = '23514';
  END IF;

  IF v_revision.delivery_line_1 IS NULL
    OR btrim(v_revision.delivery_line_1) = ''
    OR v_revision.delivery_postcode IS NULL
    OR btrim(v_revision.delivery_postcode) = '' THEN
    RAISE EXCEPTION 'Delivery address is incomplete'
      USING ERRCODE = '23514';
  END IF;

  IF v_order.current_issued_revision_id IS NOT NULL THEN
    UPDATE public.purchase_order_revisions
    SET state = 'superseded'
    WHERE id = v_order.current_issued_revision_id
      AND state = 'issued';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The current issued revision could not be superseded'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  UPDATE public.purchase_order_revisions
  SET
    state = 'issued',
    supplier_name = v_supplier_name,
    issued_at = now(),
    issued_by = auth.uid(),
    issue_idempotency_key = v_key
  WHERE id = v_revision.id
    AND state = 'draft';

  IF v_order.po_number IS NULL THEN
    PERFORM 1
    FROM public.purchase_order_counters
    WHERE id IS TRUE
    FOR UPDATE;

    UPDATE public.purchase_order_counters
    SET last_number = last_number + 1
    WHERE id IS TRUE
    RETURNING last_number INTO v_number;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Purchase order counter is missing'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.purchase_orders
    SET
      po_number = 'PO-' || v_number::text,
      status = 'issued',
      current_issued_revision_id = v_revision.id,
      current_draft_revision_id = NULL
    WHERE id = v_order.id;
  ELSE
    UPDATE public.purchase_orders
    SET
      status = 'issued',
      current_issued_revision_id = v_revision.id,
      current_draft_revision_id = NULL
    WHERE id = v_order.id;
  END IF;

  PERFORM public.purchase_order_event(
    v_order.id,
    v_revision.id,
    NULL,
    'issued',
    jsonb_build_object('idempotencyKey', v_key)
  );
  PERFORM public.purchase_order_assert_pointers(v_order.id);

  RETURN public.purchase_order_document(v_revision.id, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.open_purchase_order_revision(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.purchase_orders;
  v_issued public.purchase_order_revisions;
  v_draft public.purchase_order_revisions;
  v_line public.purchase_order_lines;
  v_new_line_id uuid;
  v_number integer;
BEGIN
  PERFORM public.purchase_order_require_purchaser();
  PERFORM public.purchase_order_begin_write();

  SELECT * INTO v_order
  FROM public.purchase_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order was not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_order.status IS DISTINCT FROM 'issued'
    OR v_order.current_issued_revision_id IS NULL
    OR v_order.current_draft_revision_id IS NOT NULL
    OR public.purchase_order_received_quantity(p_order_id) <> 0 THEN
    RAISE EXCEPTION 'Only an issued purchase order with nothing received can be amended'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_issued
  FROM public.purchase_order_revisions
  WHERE id = v_order.current_issued_revision_id
  FOR UPDATE;

  IF v_issued.state IS DISTINCT FROM 'issued' THEN
    RAISE EXCEPTION 'The current issued revision is not available'
      USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(max(revision_number), 0) + 1
  INTO v_number
  FROM public.purchase_order_revisions
  WHERE purchase_order_id = p_order_id;

  INSERT INTO public.purchase_order_revisions (
    purchase_order_id,
    revision_number,
    state,
    supplier_name,
    supplier_orders_email,
    currency,
    vat_treatment,
    vat_rate,
    delivery_method,
    delivery_recipient,
    delivery_line_1,
    delivery_line_2,
    delivery_city,
    delivery_county,
    delivery_postcode,
    delivery_country,
    delivery_instructions,
    delivery_date,
    delivery_charge_ex_vat,
    delivery_charge_method,
    goods_ex_vat,
    delivery_ex_vat,
    subtotal_ex_vat,
    vat_total,
    total_inc_vat
  )
  VALUES (
    p_order_id,
    v_number,
    'draft',
    v_issued.supplier_name,
    v_issued.supplier_orders_email,
    v_issued.currency,
    v_issued.vat_treatment,
    v_issued.vat_rate,
    v_issued.delivery_method,
    v_issued.delivery_recipient,
    v_issued.delivery_line_1,
    v_issued.delivery_line_2,
    v_issued.delivery_city,
    v_issued.delivery_county,
    v_issued.delivery_postcode,
    v_issued.delivery_country,
    v_issued.delivery_instructions,
    v_issued.delivery_date,
    v_issued.delivery_charge_ex_vat,
    v_issued.delivery_charge_method,
    v_issued.goods_ex_vat,
    v_issued.delivery_ex_vat,
    v_issued.subtotal_ex_vat,
    v_issued.vat_total,
    v_issued.total_inc_vat
  )
  RETURNING * INTO v_draft;

  PERFORM set_config('candid.po_snapshot_copy', 'on', true);

  FOR v_line IN
    SELECT *
    FROM public.purchase_order_lines
    WHERE revision_id = v_issued.id
    ORDER BY line_number
  LOOP
    INSERT INTO public.purchase_order_lines (
      revision_id,
      line_number,
      line_kind,
      material_id,
      material_supplier_product_id,
      material_price_id,
      description,
      supplier_sku,
      unit,
      quantity,
      unit_price_ex_vat,
      line_total_ex_vat,
      vat_treatment
    )
    VALUES (
      v_draft.id,
      v_line.line_number,
      v_line.line_kind,
      v_line.material_id,
      v_line.material_supplier_product_id,
      v_line.material_price_id,
      v_line.description,
      v_line.supplier_sku,
      v_line.unit,
      v_line.quantity,
      v_line.unit_price_ex_vat,
      v_line.line_total_ex_vat,
      v_line.vat_treatment
    )
    RETURNING id INTO v_new_line_id;

    INSERT INTO public.purchase_order_allocations (
      line_id, target, job_id, quantity, cost_ex_vat
    )
    SELECT v_new_line_id, target, job_id, quantity, cost_ex_vat
    FROM public.purchase_order_allocations
    WHERE line_id = v_line.id;
  END LOOP;

  PERFORM set_config('candid.po_snapshot_copy', 'off', true);

  INSERT INTO public.purchase_order_charge_allocations (
    revision_id, target, job_id, amount_ex_vat, method
  )
  SELECT v_draft.id, target, job_id, amount_ex_vat, method
  FROM public.purchase_order_charge_allocations
  WHERE revision_id = v_issued.id;

  UPDATE public.purchase_orders
  SET current_draft_revision_id = v_draft.id
  WHERE id = p_order_id;

  PERFORM public.purchase_order_event(
    p_order_id,
    v_draft.id,
    NULL,
    'revision_opened',
    jsonb_build_object('issuedRevisionId', v_issued.id)
  );
  PERFORM public.purchase_order_assert_pointers(p_order_id);

  RETURN public.purchase_order_document(v_draft.id, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_purchase_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.purchase_orders;
BEGIN
  PERFORM public.purchase_order_require_purchaser();
  PERFORM public.purchase_order_begin_write();

  SELECT * INTO v_order
  FROM public.purchase_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order was not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_order.current_draft_revision_id IS NOT NULL THEN
    RAISE EXCEPTION 'Delete the draft amendment before cancelling this purchase order'
      USING ERRCODE = '23514';
  END IF;

  IF v_order.status IS DISTINCT FROM 'issued'
    OR v_order.current_issued_revision_id IS NULL
    OR public.purchase_order_received_quantity(p_order_id) <> 0 THEN
    RAISE EXCEPTION 'Only an issued purchase order with nothing received can be cancelled'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.purchase_order_revisions
  SET state = 'cancelled'
  WHERE id = v_order.current_issued_revision_id
    AND state = 'issued';

  UPDATE public.purchase_orders
  SET status = 'cancelled'
  WHERE id = p_order_id;

  PERFORM public.purchase_order_event(
    p_order_id,
    v_order.current_issued_revision_id,
    NULL,
    'cancelled',
    '{}'::jsonb
  );
  PERFORM public.purchase_order_assert_pointers(p_order_id);

  RETURN public.purchase_order_document(v_order.current_issued_revision_id, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_order_id uuid,
  p_idempotency_key text,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.purchase_orders;
  v_key text;
  v_item jsonb;
  v_line_id uuid;
  v_qty numeric;
  v_submitted jsonb := '{}'::jsonb;
  v_stored jsonb;
  v_receipt_id uuid;
  v_line_revision uuid;
  v_status text;
  v_pair record;
BEGIN
  PERFORM public.purchase_order_require_purchaser();
  PERFORM public.purchase_order_begin_write();

  v_key := btrim(coalesce(p_idempotency_key, ''));
  IF v_key = '' OR char_length(v_key) > 200 THEN
    RAISE EXCEPTION 'Idempotency key is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Receipt lines are required'
      USING ERRCODE = '22023';
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_lines)
  LOOP
    PERFORM public.purchase_order_assert_keys(v_item, ARRAY['lineId', 'quantity']);
    v_line_id := public.purchase_order_uuid(v_item->'lineId', 'lineId');
    v_qty := public.purchase_order_numeric(v_item->'quantity', 'quantity', 4);
    IF v_line_id IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Each receipt line needs a line and a positive quantity'
        USING ERRCODE = '23514';
    END IF;
    IF v_submitted ? v_line_id::text THEN
      RAISE EXCEPTION 'Receipt lines must not repeat a purchase order line'
        USING ERRCODE = '22023';
    END IF;
    v_submitted := v_submitted || jsonb_build_object(v_line_id::text, v_qty);
  END LOOP;

  IF v_submitted = '{}'::jsonb THEN
    RAISE EXCEPTION 'A receipt needs at least one line'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_order
  FROM public.purchase_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order was not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_receipt_id
  FROM public.purchase_order_receipts
  WHERE purchase_order_id = p_order_id
    AND idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    SELECT coalesce(jsonb_object_agg(line_id::text, quantity_received), '{}'::jsonb)
    INTO v_stored
    FROM public.purchase_order_receipt_lines
    WHERE receipt_id = v_receipt_id;

    IF v_stored IS DISTINCT FROM v_submitted THEN
      RAISE EXCEPTION 'This receipt key was already used with different quantities'
        USING ERRCODE = '40001';
    END IF;

    RETURN jsonb_build_object(
      'receiptId', v_receipt_id,
      'purchaseOrderId', p_order_id,
      'status', v_order.status,
      'replayed', true
    );
  END IF;

  IF v_order.current_draft_revision_id IS NOT NULL THEN
    RAISE EXCEPTION 'Issue or delete the draft amendment before receiving goods'
      USING ERRCODE = '23514';
  END IF;

  IF v_order.status NOT IN ('issued', 'partially_received')
    OR v_order.current_issued_revision_id IS NULL THEN
    RAISE EXCEPTION 'Goods can only be received against the current issued revision'
      USING ERRCODE = '23514';
  END IF;

  PERFORM line.id
  FROM public.purchase_order_lines AS line
  WHERE line.revision_id = v_order.current_issued_revision_id
  ORDER BY line.id
  FOR UPDATE;

  FOR v_pair IN
    SELECT key::uuid AS line_id, value::numeric AS quantity
    FROM jsonb_each(v_submitted)
    ORDER BY key::uuid
  LOOP
    SELECT revision_id
    INTO v_line_revision
    FROM public.purchase_order_lines
    WHERE id = v_pair.line_id;

    IF NOT FOUND OR v_line_revision IS DISTINCT FROM v_order.current_issued_revision_id THEN
      RAISE EXCEPTION 'Receipt line is not on the current issued revision'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  INSERT INTO public.purchase_order_receipts (
    purchase_order_id,
    revision_id,
    idempotency_key,
    received_by
  )
  VALUES (
    p_order_id,
    v_order.current_issued_revision_id,
    v_key,
    auth.uid()
  )
  RETURNING id INTO v_receipt_id;

  FOR v_pair IN
    SELECT key::uuid AS line_id, value::numeric AS quantity
    FROM jsonb_each(v_submitted)
    ORDER BY key::uuid
  LOOP
    INSERT INTO public.purchase_order_receipt_lines (
      receipt_id, line_id, quantity_received
    )
    VALUES (v_receipt_id, v_pair.line_id, v_pair.quantity);
  END LOOP;

  v_status := public.purchase_order_refresh_status(p_order_id);

  PERFORM public.purchase_order_event(
    p_order_id,
    v_order.current_issued_revision_id,
    v_receipt_id,
    'receipt_recorded',
    jsonb_build_object('idempotencyKey', v_key)
  );
  PERFORM public.purchase_order_assert_pointers(p_order_id);

  RETURN jsonb_build_object(
    'receiptId', v_receipt_id,
    'purchaseOrderId', p_order_id,
    'status', v_status,
    'replayed', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_can_store_purchase_order_pdf(p_revision_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_revision public.purchase_order_revisions;
  v_path text;
BEGIN
  PERFORM public.purchase_order_require_purchaser();

  SELECT * INTO v_revision
  FROM public.purchase_order_revisions
  WHERE id = p_revision_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order revision was not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_revision.state = 'draft' OR v_revision.issued_at IS NULL THEN
    RAISE EXCEPTION 'Only an issued revision can store a PDF'
      USING ERRCODE = '23514';
  END IF;

  IF v_revision.pdf_sha256 IS NOT NULL THEN
    RAISE EXCEPTION 'Purchase order PDF is already stored'
      USING ERRCODE = '23514';
  END IF;

  v_path := 'purchase-orders/' || v_revision.purchase_order_id::text
    || '/revisions/' || v_revision.id::text || '.pdf';

  RETURN jsonb_build_object(
    'revisionId', v_revision.id,
    'path', v_path
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_purchase_order_pdf(
  p_revision_id uuid,
  p_path text,
  p_sha256 text,
  p_byte_size integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_revision public.purchase_order_revisions;
  v_order_id uuid;
  v_path text;
  v_hash text;
  v_metadata jsonb;
  v_replayed boolean := false;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Only the server can store a purchase order PDF'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.purchase_order_begin_write();
  v_hash := lower(btrim(coalesce(p_sha256, '')));

  IF v_hash !~ '^[0-9a-f]{64}$' OR p_byte_size IS NULL OR p_byte_size <= 0 OR p_byte_size > 10485760 THEN
    RAISE EXCEPTION 'Purchase order PDF metadata is not valid'
      USING ERRCODE = '23514';
  END IF;

  SELECT purchase_order_id
  INTO v_order_id
  FROM public.purchase_order_revisions
  WHERE id = p_revision_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order revision was not found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.purchase_orders
  WHERE id = v_order_id
  FOR UPDATE;

  SELECT * INTO v_revision
  FROM public.purchase_order_revisions
  WHERE id = p_revision_id
  FOR UPDATE;

  v_path := 'purchase-orders/' || v_revision.purchase_order_id::text
    || '/revisions/' || v_revision.id::text || '.pdf';

  IF p_path IS DISTINCT FROM v_path THEN
    RAISE EXCEPTION 'Purchase order PDF path is not valid'
      USING ERRCODE = '23514';
  END IF;

  IF v_revision.state = 'draft' OR v_revision.issued_at IS NULL THEN
    RAISE EXCEPTION 'Only an issued revision can store a PDF'
      USING ERRCODE = '23514';
  END IF;

  IF v_revision.pdf_sha256 IS NOT NULL THEN
    IF v_revision.pdf_sha256 = v_hash
      AND v_revision.pdf_storage_path = v_path
      AND v_revision.pdf_byte_size = p_byte_size THEN
      RETURN jsonb_build_object('stored', true, 'replayed', true);
    END IF;
    RAISE EXCEPTION 'A different purchase order PDF is already stored'
      USING ERRCODE = '23514';
  END IF;

  SELECT metadata
  INTO v_metadata
  FROM storage.objects
  WHERE bucket_id = 'purchase-order-files'
    AND name = v_path
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order PDF has not been uploaded'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_metadata IS NOT NULL
    AND v_metadata ? 'size'
    AND jsonb_typeof(v_metadata->'size') = 'number'
    AND (v_metadata->>'size')::numeric IS DISTINCT FROM p_byte_size THEN
    RAISE EXCEPTION 'Uploaded PDF size does not match'
      USING ERRCODE = '23514';
  END IF;

  IF v_metadata IS NOT NULL
    AND v_metadata ? 'mimetype'
    AND jsonb_typeof(v_metadata->'mimetype') = 'string'
    AND v_metadata->>'mimetype' IS DISTINCT FROM 'application/pdf' THEN
    RAISE EXCEPTION 'Uploaded file must be a PDF'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.purchase_order_revisions
  SET
    pdf_storage_path = v_path,
    pdf_sha256 = v_hash,
    pdf_byte_size = p_byte_size
  WHERE id = p_revision_id;

  PERFORM public.purchase_order_event(
    v_revision.purchase_order_id,
    p_revision_id,
    NULL,
    'pdf_stored',
    jsonb_build_object('path', v_path, 'sha256', v_hash)
  );

  RETURN jsonb_build_object('stored', true, 'replayed', v_replayed);
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_order_require_sender()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN;
  END IF;
  PERFORM public.purchase_order_require_purchaser();
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_purchase_order_email(p_revision_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_revision public.purchase_order_revisions;
  v_order public.purchase_orders;
  v_order_id uuid;
  v_dispatch public.purchase_order_email_dispatches;
BEGIN
  PERFORM public.purchase_order_require_sender();
  PERFORM public.purchase_order_begin_write();

  SELECT purchase_order_id
  INTO v_order_id
  FROM public.purchase_order_revisions
  WHERE id = p_revision_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order revision was not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_order
  FROM public.purchase_orders
  WHERE id = v_order_id
  FOR UPDATE;

  SELECT * INTO v_revision
  FROM public.purchase_order_revisions
  WHERE id = p_revision_id
  FOR UPDATE;

  IF v_order.current_issued_revision_id IS DISTINCT FROM p_revision_id
    OR v_revision.state IS DISTINCT FROM 'issued'
    OR v_revision.pdf_sha256 IS NULL THEN
    RAISE EXCEPTION 'Only the current issued revision with a stored PDF can be emailed'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_dispatch
  FROM public.purchase_order_email_dispatches
  WHERE revision_id = p_revision_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.purchase_order_email_dispatches (
      revision_id,
      idempotency_key,
      status,
      requested_by
    )
    VALUES (
      p_revision_id,
      'purchase_order_sent:' || p_revision_id::text,
      'queued',
      auth.uid()
    )
    RETURNING * INTO v_dispatch;
  ELSIF v_dispatch.status = 'sending'
    AND v_dispatch.lease_until IS NOT NULL
    AND v_dispatch.lease_until < now() THEN
    UPDATE public.purchase_order_email_dispatches
    SET
      status = 'unknown',
      claim_token = NULL,
      last_error = 'The sending lease expired before the result was recorded'
    WHERE id = v_dispatch.id
    RETURNING * INTO v_dispatch;

    PERFORM public.purchase_order_event(
      v_order.id,
      p_revision_id,
      NULL,
      'email_unknown',
      jsonb_build_object('dispatchId', v_dispatch.id, 'reason', 'lease_expired')
    );
  END IF;

  RETURN jsonb_build_object(
    'dispatchId', v_dispatch.id,
    'revisionId', p_revision_id,
    'status', v_dispatch.status,
    'attemptCount', v_dispatch.attempt_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_purchase_order_email(p_dispatch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_dispatch public.purchase_order_email_dispatches;
  v_order_id uuid;
  v_token uuid;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Only the server can claim a purchase order email'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.purchase_order_begin_write();

  SELECT revision.purchase_order_id
  INTO v_order_id
  FROM public.purchase_order_email_dispatches AS dispatch
  JOIN public.purchase_order_revisions AS revision
    ON revision.id = dispatch.revision_id
  WHERE dispatch.id = p_dispatch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order email was not found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.purchase_orders
  WHERE id = v_order_id
  FOR UPDATE;

  SELECT * INTO v_dispatch
  FROM public.purchase_order_email_dispatches
  WHERE id = p_dispatch_id
  FOR UPDATE;

  IF v_dispatch.status = 'sending'
    AND v_dispatch.lease_until IS NOT NULL
    AND v_dispatch.lease_until < now() THEN
    UPDATE public.purchase_order_email_dispatches
    SET
      status = 'unknown',
      claim_token = NULL,
      last_error = 'The sending lease expired before the result was recorded'
    WHERE id = v_dispatch.id
    RETURNING * INTO v_dispatch;

    PERFORM public.purchase_order_event(
      v_order_id,
      v_dispatch.revision_id,
      NULL,
      'email_unknown',
      jsonb_build_object('dispatchId', v_dispatch.id, 'reason', 'lease_expired')
    );

    RETURN jsonb_build_object(
      'claimed', false,
      'dispatchId', v_dispatch.id,
      'claimToken', NULL,
      'status', v_dispatch.status,
      'attemptCount', v_dispatch.attempt_count
    );
  END IF;

  IF v_dispatch.status NOT IN ('queued', 'failed') THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'dispatchId', v_dispatch.id,
      'claimToken', NULL,
      'status', v_dispatch.status,
      'attemptCount', v_dispatch.attempt_count
    );
  END IF;

  v_token := gen_random_uuid();

  UPDATE public.purchase_order_email_dispatches
  SET
    status = 'sending',
    lease_until = now() + interval '2 minutes',
    attempt_count = attempt_count + 1,
    claim_token = v_token,
    last_error = NULL
  WHERE id = v_dispatch.id
    AND status IN ('queued', 'failed')
  RETURNING * INTO v_dispatch;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order email could not be claimed'
      USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'claimed', true,
    'dispatchId', v_dispatch.id,
    'claimToken', v_token,
    'status', 'sending',
    'attemptCount', v_dispatch.attempt_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_purchase_order_email(
  p_dispatch_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_provider_message_id text,
  p_error text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_dispatch public.purchase_order_email_dispatches;
  v_order_id uuid;
  v_error text;
BEGIN
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Only the server can record a purchase order email result'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.purchase_order_begin_write();

  SELECT revision.purchase_order_id
  INTO v_order_id
  FROM public.purchase_order_email_dispatches AS dispatch
  JOIN public.purchase_order_revisions AS revision
    ON revision.id = dispatch.revision_id
  WHERE dispatch.id = p_dispatch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order email was not found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.purchase_orders
  WHERE id = v_order_id
  FOR UPDATE;

  SELECT * INTO v_dispatch
  FROM public.purchase_order_email_dispatches
  WHERE id = p_dispatch_id
  FOR UPDATE;

  IF v_dispatch.status IS DISTINCT FROM 'sending'
    OR v_dispatch.claim_token IS DISTINCT FROM p_claim_token THEN
    RAISE EXCEPTION 'This email claim is no longer active'
      USING ERRCODE = '40001';
  END IF;

  v_error := nullif(btrim(coalesce(p_error, '')), '');

  IF p_outcome = 'sent' THEN
    IF nullif(btrim(coalesce(p_provider_message_id, '')), '') IS NULL THEN
      RAISE EXCEPTION 'A sent email needs the provider message id'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.purchase_order_email_dispatches
    SET
      status = 'sent',
      provider_message_id = btrim(p_provider_message_id),
      last_error = NULL,
      lease_until = NULL
    WHERE id = p_dispatch_id;

    PERFORM public.purchase_order_event(
      v_order_id, v_dispatch.revision_id, NULL, 'email_sent',
      jsonb_build_object('dispatchId', p_dispatch_id, 'providerMessageId', btrim(p_provider_message_id))
    );
  ELSIF p_outcome = 'failed' THEN
    UPDATE public.purchase_order_email_dispatches
    SET
      status = 'failed',
      last_error = coalesce(v_error, 'The email provider rejected the message'),
      lease_until = NULL,
      claim_token = NULL
    WHERE id = p_dispatch_id;

    PERFORM public.purchase_order_event(
      v_order_id, v_dispatch.revision_id, NULL, 'email_failed',
      jsonb_build_object('dispatchId', p_dispatch_id)
    );
  ELSIF p_outcome = 'unknown' THEN
    UPDATE public.purchase_order_email_dispatches
    SET
      status = 'unknown',
      last_error = coalesce(v_error, 'The email provider did not confirm whether the message was sent'),
      lease_until = NULL,
      claim_token = NULL
    WHERE id = p_dispatch_id;

    PERFORM public.purchase_order_event(
      v_order_id, v_dispatch.revision_id, NULL, 'email_unknown',
      jsonb_build_object('dispatchId', p_dispatch_id)
    );
  ELSE
    RAISE EXCEPTION 'Email outcome is not supported'
      USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'dispatchId', p_dispatch_id,
    'status', p_outcome
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_unknown_purchase_order_email(
  p_dispatch_id uuid,
  p_decision text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_dispatch public.purchase_order_email_dispatches;
  v_order_id uuid;
  v_provider text;
BEGIN
  PERFORM public.purchase_order_require_purchaser();
  PERFORM public.purchase_order_begin_write();

  IF p_decision NOT IN ('mark_sent', 'allow_retry') THEN
    RAISE EXCEPTION 'Email resolution is not supported'
      USING ERRCODE = '22023';
  END IF;

  SELECT revision.purchase_order_id
  INTO v_order_id
  FROM public.purchase_order_email_dispatches AS dispatch
  JOIN public.purchase_order_revisions AS revision
    ON revision.id = dispatch.revision_id
  WHERE dispatch.id = p_dispatch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order email was not found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.purchase_orders
  WHERE id = v_order_id
  FOR UPDATE;

  SELECT * INTO v_dispatch
  FROM public.purchase_order_email_dispatches
  WHERE id = p_dispatch_id
  FOR UPDATE;

  IF v_dispatch.status IS DISTINCT FROM 'unknown' THEN
    RAISE EXCEPTION 'Only an unknown email can be resolved'
      USING ERRCODE = '23514';
  END IF;

  IF p_decision = 'mark_sent' THEN
    UPDATE public.purchase_order_email_dispatches
    SET
      status = 'sent',
      lease_until = NULL
    WHERE id = p_dispatch_id
    RETURNING provider_message_id INTO v_provider;

    PERFORM public.purchase_order_event(
      v_order_id, v_dispatch.revision_id, NULL, 'email_marked_sent',
      jsonb_build_object('dispatchId', p_dispatch_id, 'providerMessageId', v_provider)
    );
  ELSE
    UPDATE public.purchase_order_email_dispatches
    SET
      status = 'failed',
      claim_token = NULL,
      lease_until = NULL,
      last_error = 'Staff allowed another send after an unknown result. A duplicate email is possible.'
    WHERE id = p_dispatch_id;

    PERFORM public.purchase_order_event(
      v_order_id, v_dispatch.revision_id, NULL, 'email_retry_allowed',
      jsonb_build_object('dispatchId', p_dispatch_id, 'duplicatePossible', true)
    );
  END IF;

  RETURN jsonb_build_object(
    'dispatchId', p_dispatch_id,
    'decision', p_decision
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Access. Purchasers can read. Commercial writes stay inside the functions.
-- ---------------------------------------------------------------------------

ALTER TABLE public.purchase_order_revisions
  ADD CONSTRAINT purchase_order_revisions_pdf_path_check
  CHECK (
    pdf_storage_path IS NULL
    OR pdf_storage_path = 'purchase-orders/' || purchase_order_id::text
      || '/revisions/' || id::text || '.pdf'
  );

ALTER TABLE public.purchase_order_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_charge_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_email_dispatches ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_supplier_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_prices ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.purchase_order_counters FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.purchase_orders FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.purchase_order_revisions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.purchase_order_lines FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.purchase_order_allocations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.purchase_order_charge_allocations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.purchase_order_receipts FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.purchase_order_receipt_lines FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.purchase_order_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.purchase_order_email_dispatches FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.purchase_orders TO authenticated, service_role;
GRANT SELECT ON TABLE public.purchase_order_revisions TO authenticated, service_role;
GRANT SELECT ON TABLE public.purchase_order_lines TO authenticated, service_role;
GRANT SELECT ON TABLE public.purchase_order_allocations TO authenticated, service_role;
GRANT SELECT ON TABLE public.purchase_order_charge_allocations TO authenticated, service_role;
GRANT SELECT ON TABLE public.purchase_order_receipts TO authenticated, service_role;
GRANT SELECT ON TABLE public.purchase_order_receipt_lines TO authenticated, service_role;
GRANT SELECT ON TABLE public.purchase_order_events TO authenticated, service_role;
-- service_role can read the claim token. Purchasers can read the outbox
-- except that column; a table-level SELECT grant would expose it again.
GRANT SELECT ON TABLE public.purchase_order_email_dispatches TO service_role;
GRANT SELECT (
  id,
  revision_id,
  idempotency_key,
  status,
  attempt_count,
  lease_until,
  provider_message_id,
  last_error,
  requested_by,
  created_at,
  updated_at
) ON TABLE public.purchase_order_email_dispatches TO authenticated;

DROP POLICY IF EXISTS purchase_orders_select_purchaser ON public.purchase_orders;
CREATE POLICY purchase_orders_select_purchaser
  ON public.purchase_orders FOR SELECT TO authenticated
  USING (public.can_issue_purchase_orders());

DROP POLICY IF EXISTS purchase_order_revisions_select_purchaser ON public.purchase_order_revisions;
CREATE POLICY purchase_order_revisions_select_purchaser
  ON public.purchase_order_revisions FOR SELECT TO authenticated
  USING (public.can_issue_purchase_orders());

DROP POLICY IF EXISTS purchase_order_lines_select_purchaser ON public.purchase_order_lines;
CREATE POLICY purchase_order_lines_select_purchaser
  ON public.purchase_order_lines FOR SELECT TO authenticated
  USING (public.can_issue_purchase_orders());

DROP POLICY IF EXISTS purchase_order_allocations_select_purchaser ON public.purchase_order_allocations;
CREATE POLICY purchase_order_allocations_select_purchaser
  ON public.purchase_order_allocations FOR SELECT TO authenticated
  USING (public.can_issue_purchase_orders());

DROP POLICY IF EXISTS purchase_order_charge_allocations_select_purchaser ON public.purchase_order_charge_allocations;
CREATE POLICY purchase_order_charge_allocations_select_purchaser
  ON public.purchase_order_charge_allocations FOR SELECT TO authenticated
  USING (public.can_issue_purchase_orders());

DROP POLICY IF EXISTS purchase_order_receipts_select_purchaser ON public.purchase_order_receipts;
CREATE POLICY purchase_order_receipts_select_purchaser
  ON public.purchase_order_receipts FOR SELECT TO authenticated
  USING (public.can_issue_purchase_orders());

DROP POLICY IF EXISTS purchase_order_receipt_lines_select_purchaser ON public.purchase_order_receipt_lines;
CREATE POLICY purchase_order_receipt_lines_select_purchaser
  ON public.purchase_order_receipt_lines FOR SELECT TO authenticated
  USING (public.can_issue_purchase_orders());

DROP POLICY IF EXISTS purchase_order_events_select_purchaser ON public.purchase_order_events;
CREATE POLICY purchase_order_events_select_purchaser
  ON public.purchase_order_events FOR SELECT TO authenticated
  USING (public.can_issue_purchase_orders());

DROP POLICY IF EXISTS purchase_order_email_dispatches_select_purchaser ON public.purchase_order_email_dispatches;
CREATE POLICY purchase_order_email_dispatches_select_purchaser
  ON public.purchase_order_email_dispatches FOR SELECT TO authenticated
  USING (public.can_issue_purchase_orders());

DROP POLICY IF EXISTS suppliers_select_purchaser ON public.suppliers;
CREATE POLICY suppliers_select_purchaser
  ON public.suppliers FOR SELECT TO authenticated
  USING (active AND public.can_issue_purchase_orders());

DROP POLICY IF EXISTS materials_select_purchaser ON public.materials;
CREATE POLICY materials_select_purchaser
  ON public.materials FOR SELECT TO authenticated
  USING (active AND public.can_issue_purchase_orders());

DROP POLICY IF EXISTS material_supplier_products_select_purchaser ON public.material_supplier_products;
CREATE POLICY material_supplier_products_select_purchaser
  ON public.material_supplier_products FOR SELECT TO authenticated
  USING (
    active
    AND public.can_issue_purchase_orders()
    AND EXISTS (
      SELECT 1
      FROM public.materials AS material
      JOIN public.suppliers AS supplier
        ON supplier.id = material_supplier_products.supplier_id
      WHERE material.id = material_supplier_products.material_id
        AND material.active
        AND supplier.active
    )
  );

DROP POLICY IF EXISTS material_prices_select_purchaser ON public.material_prices;
CREATE POLICY material_prices_select_purchaser
  ON public.material_prices FOR SELECT TO authenticated
  USING (
    public.can_issue_purchase_orders()
    AND EXISTS (
      SELECT 1
      FROM public.material_supplier_products AS product
      JOIN public.materials AS material
        ON material.id = product.material_id
      JOIN public.suppliers AS supplier
        ON supplier.id = product.supplier_id
      WHERE product.id = material_prices.material_supplier_product_id
        AND product.active
        AND material.active
        AND supplier.active
    )
  );

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'purchase-order-files',
  'purchase-order-files',
  false,
  10485760,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS purchase_order_files_storage_select_purchaser ON storage.objects;
CREATE POLICY purchase_order_files_storage_select_purchaser
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'purchase-order-files'
    AND public.can_issue_purchase_orders()
  );

REVOKE ALL ON FUNCTION public.can_issue_purchase_orders() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_purchase_order_issuer(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.profiles_guard_purchase_order_issuer() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profiles_guard_purchase_order_issuer() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_purchase_order(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_purchase_order_draft(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_purchase_order_draft(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.refresh_purchase_order_prices(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.issue_purchase_order(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.open_purchase_order_revision(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_purchase_order(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.receive_purchase_order(uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assert_can_store_purchase_order_pdf(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.attach_purchase_order_pdf(uuid, text, text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enqueue_purchase_order_email(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_purchase_order_email(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_purchase_order_email(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_unknown_purchase_order_email(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.can_issue_purchase_orders() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_purchase_order_issuer(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_purchase_order_draft(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_purchase_order_draft(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_purchase_order_prices(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_purchase_order(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_purchase_order_revision(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_can_store_purchase_order_pdf(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attach_purchase_order_pdf(uuid, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_purchase_order_email(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_purchase_order_email(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_purchase_order_email(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_unknown_purchase_order_email(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.suppliers_normalize_orders_email() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_begin_write() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_require_write() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_require_purchaser() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_require_sender() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_revision_commercial(public.purchase_order_revisions) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_counters_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_assert_pointers(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_revision_pointer_trigger() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_orders_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_revisions_normalize_email() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_revisions_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_lines_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_allocations_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_charge_allocations_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_receipts_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_receipt_lines_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_events_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_email_dispatches_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_assert_keys(jsonb, text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_optional_text(jsonb, text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_numeric(jsonb, text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_uuid(jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_standard_vat_rate() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_vat_amount(text, numeric, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_workshop_address() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_event(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_lock_lines(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_received_quantity(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_document(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_refresh_status(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_recalculate_draft(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_order_assert_issueable(uuid) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.issue_purchase_order(uuid, text) IS
  'Issues the current draft. The first issue allocates PO-1001 onwards. A repeated key returns the original revision. Selected catalogue prices are not refreshed.';

COMMENT ON FUNCTION public.claim_purchase_order_email(uuid) IS
  'Service role only. Claims a queued or failed email. An expired sending lease becomes unknown and is not claimed again.';

COMMENT ON FUNCTION public.complete_purchase_order_email(uuid, uuid, text, text, text) IS
  'Service role only. Records the provider result for the active claim token.';

COMMENT ON FUNCTION public.resolve_unknown_purchase_order_email(uuid, text) IS
  'Explicit purchaser decision after an ambiguous send. allow_retry can produce a duplicate email.';

COMMENT ON COLUMN public.purchase_order_email_dispatches.claim_token IS
  'Granted to service_role only. Authenticated purchasers cannot read it.';

COMMIT;
