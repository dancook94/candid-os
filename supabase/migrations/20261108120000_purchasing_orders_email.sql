-- Allow supplier orders email to be corrected on the current issued revision before send.

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
    IF coalesce(current_setting('candid.po_orders_email_only', true), '') = 'on'
      AND NEW.state = 'issued'
      AND OLD.supplier_orders_email IS DISTINCT FROM NEW.supplier_orders_email
      AND (public.purchase_order_revision_commercial(OLD) - 'supplier_orders_email')
        IS NOT DISTINCT FROM (public.purchase_order_revision_commercial(NEW) - 'supplier_orders_email')
    THEN
      RETURN NEW;
    END IF;

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

CREATE OR REPLACE FUNCTION public.set_issued_purchase_order_orders_email(
  p_revision_id uuid,
  p_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.purchase_orders;
  v_email text;
BEGIN
  PERFORM public.purchase_order_require_purchaser();
  PERFORM public.purchase_order_begin_write();

  v_email := lower(btrim(coalesce(p_email, '')));
  IF v_email = '' OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Supplier email is not valid'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_order
  FROM public.purchase_orders AS purchase_order
  JOIN public.purchase_order_revisions AS revision
    ON revision.id = purchase_order.current_issued_revision_id
  WHERE revision.id = p_revision_id
  FOR UPDATE OF purchase_order, revision;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the current issued revision can be updated'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.purchase_order_email_dispatches AS dispatch
    WHERE dispatch.revision_id = p_revision_id
      AND dispatch.status = 'sent'
  ) THEN
    RAISE EXCEPTION 'This purchase order was already emailed to the supplier'
      USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('candid.po_orders_email_only', 'on', true);
  UPDATE public.purchase_order_revisions
  SET supplier_orders_email = v_email
  WHERE id = p_revision_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_issued_purchase_order_orders_email(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_issued_purchase_order_orders_email(uuid, text) TO authenticated;
