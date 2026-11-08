-- Bulk review validation for the Test project only.
-- Project ref: axhkdwgmwhlbsstumndh
-- Do not open or run this in Live (wdpfqkqnoyeshocwzrxh).
--
-- Paste and run this whole file once, on the SQL Editor's default database role.
-- The editor shows a red error at the end. That error is the report.
-- It starts and ends with OVERALL PASS or OVERALL FAIL.
-- The error is raised on purpose. PostgreSQL then rolls back every write from
-- this script, so no disposable invoice, material, price, or event is kept.
-- There is no COMMIT in this script.

DO $validation$
DECLARE
  v_names text[] := ARRAY[
    'ignore_bulk_invoice_charges',
    'confirm_bulk_invoice_products',
    'retain_bulk_historical_invoice_prices',
    'approve_bulk_invoice_price',
    'set_bulk_invoice_purchase_units',
    'create_bulk_material_from_invoice_lines',
    'accept_bulk_rounding_discrepancy'
  ];
  v_name text;
  v_oid oid;
  v_missing text := '';
  v_grant_problem text := '';
  v_anon_problem text := '';
  v_non_admin_problem text := '';
  v_detail text;
  v_raised boolean;
  v_admin uuid;
  v_token text;
  v_can_write boolean := false;
  v_json jsonb;
  v_def text;
  v_count integer;
  v_price numeric;
  v_raw_description text;
  v_raw_quantity numeric;
  v_raw_unit text;
  v_raw_unit_price numeric;
  v_raw_line_total numeric;
  v_subtotal numeric;
  v_vat numeric;
  v_total numeric;
  v_rec record;
  v_report text := '';
  v_overall text;
BEGIN
  CREATE TEMP TABLE bulk_review_validation_results (
    step integer PRIMARY KEY,
    check_name text NOT NULL,
    result text NOT NULL,
    detail text NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE bulk_review_validation_ids (
    name text PRIMARY KEY,
    id uuid NOT NULL
  ) ON COMMIT DROP;

  CREATE OR REPLACE FUNCTION pg_temp.passfail(p_step integer, p_name text, p_ok boolean, p_detail text)
  RETURNS text
  LANGUAGE plpgsql
  SET search_path = pg_temp, public
  AS $passfail$
  DECLARE
    v_result text := CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END;
    v_detail text := left(replace(replace(coalesce(p_detail, ''), E'\n', ' '), E'\t', ' '), 500);
    v_line text;
  BEGIN
    v_line := p_step::text || E'\t' || v_result || E'\t' || p_name || E'\t' || v_detail;
    INSERT INTO bulk_review_validation_results (step, check_name, result, detail)
    VALUES (p_step, p_name, v_result, v_detail);
    RETURN v_line;
  END;
  $passfail$;

  CREATE OR REPLACE FUNCTION pg_temp.keep(p_name text, p_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SET search_path = pg_temp, public
  AS $keep$
  BEGIN
    INSERT INTO bulk_review_validation_ids (name, id) VALUES (p_name, p_id);
    RETURN p_id;
  END;
  $keep$;

  CREATE OR REPLACE FUNCTION pg_temp.fid(p_name text)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = pg_temp, public
  AS $fid$
    SELECT id FROM bulk_review_validation_ids WHERE name = p_name;
  $fid$;

  CREATE OR REPLACE FUNCTION pg_temp.make_invoice(p_name text, p_number text, p_date date)
  RETURNS uuid
  LANGUAGE plpgsql
  SET search_path = pg_temp, public
  AS $make_invoice$
  DECLARE
    v_id uuid;
  BEGIN
    INSERT INTO public.supplier_invoices (
      supplier_id,
      invoice_number,
      invoice_date,
      subtotal,
      vat,
      total,
      extraction_status,
      processing_status,
      source_type,
      created_by
    )
    VALUES (
      pg_temp.fid('supplier'),
      p_number,
      p_date,
      100.00,
      20.00,
      120.00,
      'extracted',
      'unmatched',
      'manual_upload',
      pg_temp.fid('admin')
    )
    RETURNING id INTO v_id;

    RETURN pg_temp.keep(p_name, v_id);
  END;
  $make_invoice$;

  CREATE OR REPLACE FUNCTION pg_temp.make_line(
    p_name text,
    p_invoice text,
    p_line_number integer,
    p_description text,
    p_quantity numeric,
    p_unit text,
    p_unit_price numeric,
    p_line_total numeric,
    p_status text,
    p_maths text,
    p_product text,
    p_confidence text
  )
  RETURNS uuid
  LANGUAGE plpgsql
  SET search_path = pg_temp, public
  AS $make_line$
  DECLARE
    v_id uuid;
  BEGIN
    INSERT INTO public.supplier_invoice_lines (
      invoice_id,
      line_number,
      raw_description,
      raw_quantity,
      raw_unit,
      raw_unit_price,
      raw_line_total,
      review_status,
      maths_warning,
      matched_supplier_product_id,
      match_confidence
    )
    VALUES (
      pg_temp.fid(p_invoice),
      p_line_number,
      p_description,
      p_quantity,
      p_unit,
      p_unit_price,
      p_line_total,
      p_status,
      p_maths,
      CASE WHEN p_product IS NULL THEN NULL ELSE pg_temp.fid(p_product) END,
      p_confidence
    )
    RETURNING id INTO v_id;

    RETURN pg_temp.keep(p_name, v_id);
  END;
  $make_line$;

  CREATE OR REPLACE FUNCTION pg_temp.make_product(
    p_material text,
    p_product text,
    p_price text,
    p_name text,
    p_unit text,
    p_description text,
    p_amount numeric,
    p_effective date
  )
  RETURNS uuid
  LANGUAGE plpgsql
  SET search_path = pg_temp, public
  AS $make_product$
  DECLARE
    v_material uuid;
    v_product uuid;
    v_price uuid;
  BEGIN
    INSERT INTO public.materials (name, purchase_unit, identity_key, active)
    VALUES (p_name, p_unit, 'pending', true)
    RETURNING id INTO v_material;

    INSERT INTO public.material_supplier_products (
      material_id,
      supplier_id,
      supplier_description,
      normalized_description,
      is_preferred,
      active
    )
    VALUES (
      v_material,
      pg_temp.fid('supplier'),
      p_description,
      lower(p_description),
      false,
      true
    )
    RETURNING id INTO v_product;

    INSERT INTO public.material_prices (
      material_supplier_product_id,
      price,
      currency,
      price_unit,
      effective_date,
      approved_by,
      source_type,
      source_reference
    )
    VALUES (
      v_product,
      p_amount,
      'GBP',
      p_unit,
      p_effective,
      pg_temp.fid('admin'),
      'validation',
      p_price
    )
    RETURNING id INTO v_price;

    PERFORM pg_temp.keep(p_material, v_material);
    PERFORM pg_temp.keep(p_product, v_product);
    PERFORM pg_temp.keep(p_price, v_price);
    RETURN v_product;
  END;
  $make_product$;

  BEGIN
  SELECT count(*) INTO v_count
  FROM pg_proc AS proc
  JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = ANY (v_names);

  v_report := v_report || pg_temp.passfail(1, 'seven bulk-review functions exist', v_count = 7, 'found ' || v_count::text) || E'\n';

  FOREACH v_name IN ARRAY v_names LOOP
    SELECT proc.oid INTO v_oid
    FROM pg_proc AS proc
    JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'public'
      AND proc.proname = v_name;

    IF v_oid IS NULL THEN
      v_missing := v_missing || v_name || ' ';
    ELSIF has_function_privilege('anon', v_oid, 'execute')
      OR has_function_privilege('public', v_oid, 'execute')
      OR NOT has_function_privilege('authenticated', v_oid, 'execute') THEN
      v_grant_problem := v_grant_problem || v_name || ' ';
    END IF;
  END LOOP;

  v_report := v_report || pg_temp.passfail(
    2,
    'execute granted only to authenticated',
    v_missing = '' AND v_grant_problem = '',
    CASE
      WHEN v_missing <> '' THEN 'missing ' || v_missing
      WHEN v_grant_problem <> '' THEN 'grant mismatch ' || v_grant_problem
      ELSE 'anon and public revoked; authenticated granted'
    END
  ) || E'\n';

  FOREACH v_name IN ARRAY v_names LOOP
    BEGIN
      SET LOCAL ROLE anon;
      CASE v_name
        WHEN 'ignore_bulk_invoice_charges' THEN
          PERFORM public.ignore_bulk_invoice_charges(ARRAY[]::uuid[], '00000000-0000-0000-0000-000000000000'::uuid);
        WHEN 'confirm_bulk_invoice_products' THEN
          PERFORM public.confirm_bulk_invoice_products(ARRAY[]::uuid[], '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid);
        WHEN 'retain_bulk_historical_invoice_prices' THEN
          PERFORM public.retain_bulk_historical_invoice_prices(ARRAY[]::uuid[], '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 1, '00000000-0000-0000-0000-000000000000'::uuid);
        WHEN 'approve_bulk_invoice_price' THEN
          PERFORM public.approve_bulk_invoice_price(ARRAY[]::uuid[], '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 1, '00000000-0000-0000-0000-000000000000'::uuid);
        WHEN 'set_bulk_invoice_purchase_units' THEN
          PERFORM public.set_bulk_invoice_purchase_units(ARRAY[]::uuid[], 'litre', '00000000-0000-0000-0000-000000000000'::uuid);
        WHEN 'create_bulk_material_from_invoice_lines' THEN
          PERFORM public.create_bulk_material_from_invoice_lines(ARRAY[]::uuid[], '00000000-0000-0000-0000-000000000000'::uuid, 'name', 'litre', NULL, NULL, NULL, NULL, 1);
        WHEN 'accept_bulk_rounding_discrepancy' THEN
          PERFORM public.accept_bulk_rounding_discrepancy(ARRAY[]::uuid[], '00000000-0000-0000-0000-000000000000'::uuid);
        ELSE
          RAISE EXCEPTION 'Unknown bulk-review function %', v_name;
      END CASE;
      v_anon_problem := v_anon_problem || v_name || ' executed ';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM ILIKE '%permission denied%' AND position(v_name in SQLERRM) > 0 THEN
          NULL;
        ELSE
          v_anon_problem := v_anon_problem || v_name || ' [' || SQLSTATE || ' ' || SQLERRM || '] ';
        END IF;
    END;
  END LOOP;
  RESET ROLE;

  v_report := v_report || pg_temp.passfail(
    3,
    'anon cannot execute the seven functions',
    v_anon_problem = '',
    CASE WHEN v_anon_problem = '' THEN 'permission denied for all seven' ELSE v_anon_problem END
  ) || E'\n';

  SELECT id INTO v_admin
  FROM public.profiles
  WHERE account_status = 'approved'
    AND user_role IN ('super_admin', 'admin')
  ORDER BY created_at
  LIMIT 1;

  v_report := v_report || pg_temp.passfail(
    4,
    'an approved Test admin is available',
    v_admin IS NOT NULL,
    coalesce(v_admin::text, 'no approved admin profile')
  ) || E'\n';

  FOREACH v_name IN ARRAY v_names LOOP
    BEGIN
      PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
      PERFORM set_config(
        'request.jwt.claims',
        '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}',
        true
      );
      SET LOCAL ROLE authenticated;
      CASE v_name
        WHEN 'ignore_bulk_invoice_charges' THEN
          PERFORM public.ignore_bulk_invoice_charges(ARRAY[]::uuid[], '00000000-0000-0000-0000-000000000000'::uuid);
        WHEN 'confirm_bulk_invoice_products' THEN
          PERFORM public.confirm_bulk_invoice_products(ARRAY[]::uuid[], '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid);
        WHEN 'retain_bulk_historical_invoice_prices' THEN
          PERFORM public.retain_bulk_historical_invoice_prices(ARRAY[]::uuid[], '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 1, '00000000-0000-0000-0000-000000000000'::uuid);
        WHEN 'approve_bulk_invoice_price' THEN
          PERFORM public.approve_bulk_invoice_price(ARRAY[]::uuid[], '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 1, '00000000-0000-0000-0000-000000000000'::uuid);
        WHEN 'set_bulk_invoice_purchase_units' THEN
          PERFORM public.set_bulk_invoice_purchase_units(ARRAY[]::uuid[], 'litre', '00000000-0000-0000-0000-000000000000'::uuid);
        WHEN 'create_bulk_material_from_invoice_lines' THEN
          PERFORM public.create_bulk_material_from_invoice_lines(ARRAY[]::uuid[], '00000000-0000-0000-0000-000000000000'::uuid, 'name', 'litre', NULL, NULL, NULL, NULL, 1);
        WHEN 'accept_bulk_rounding_discrepancy' THEN
          PERFORM public.accept_bulk_rounding_discrepancy(ARRAY[]::uuid[], '00000000-0000-0000-0000-000000000000'::uuid);
        ELSE
          RAISE EXCEPTION 'Unknown bulk-review function %', v_name;
      END CASE;
      v_non_admin_problem := v_non_admin_problem || v_name || ' executed ';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM ILIKE '%Not allowed%' THEN
          NULL;
        ELSE
          v_non_admin_problem := v_non_admin_problem || v_name || ' [' || SQLSTATE || ' ' || SQLERRM || '] ';
        END IF;
    END;
  END LOOP;
  RESET ROLE;

  v_report := v_report || pg_temp.passfail(
    5,
    'authenticated non-admin writes are rejected',
    v_non_admin_problem = '',
    CASE WHEN v_non_admin_problem = '' THEN 'Not allowed for all seven' ELSE v_non_admin_problem END
  ) || E'\n';

  PERFORM set_config('request.jwt.claim.sub', coalesce(v_admin::text, ''), true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', coalesce(v_admin::text, ''), 'role', 'authenticated')::text,
    true
  );

  v_report := v_report || pg_temp.passfail(
    6,
    'approved admin identity is active',
    v_admin IS NOT NULL AND auth.uid() = v_admin AND public.is_approved_candid_admin(),
    'auth.uid=' || coalesce(auth.uid()::text, 'null')
  ) || E'\n';

  v_can_write := v_admin IS NOT NULL AND auth.uid() = v_admin AND public.is_approved_candid_admin();

  IF v_can_write THEN
    BEGIN
      PERFORM public.ignore_bulk_invoice_charges(ARRAY[]::uuid[], '00000000-0000-0000-0000-000000000000');
      v_raised := false;
      v_detail := 'call succeeded';
    EXCEPTION
      WHEN OTHERS THEN
        v_raised := true;
        v_detail := SQLSTATE || ' ' || SQLERRM;
    END;

    v_report := v_report || pg_temp.passfail(
      7,
      'admin actor must match auth.uid',
      v_raised AND v_detail ILIKE '%Not allowed%',
      v_detail
    ) || E'\n';
  END IF;

  v_report := v_report || pg_temp.passfail(
    8,
    'historical price table privileges',
    has_table_privilege('authenticated', 'public.supplier_invoice_historical_prices', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.supplier_invoice_historical_prices', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.supplier_invoice_historical_prices', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.supplier_invoice_historical_prices', 'DELETE')
      AND NOT has_table_privilege('anon', 'public.supplier_invoice_historical_prices', 'SELECT')
      AND NOT has_table_privilege('anon', 'public.supplier_invoice_historical_prices', 'INSERT')
      AND NOT has_table_privilege('anon', 'public.supplier_invoice_historical_prices', 'UPDATE')
      AND NOT has_table_privilege('anon', 'public.supplier_invoice_historical_prices', 'DELETE'),
    'authenticated select only; anon has no table privileges'
  ) || E'\n';

  SELECT class.relrowsecurity INTO v_raised
  FROM pg_class AS class
  JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
  WHERE namespace.nspname = 'public'
    AND class.relname = 'supplier_invoice_historical_prices';

  v_report := v_report || pg_temp.passfail(
    9,
    'historical price row security and select policy',
    coalesce(v_raised, false)
      AND EXISTS (
        SELECT 1
        FROM pg_policy
        WHERE polrelid = 'public.supplier_invoice_historical_prices'::regclass
          AND polcmd = 'r'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_policy
        WHERE polrelid = 'public.supplier_invoice_historical_prices'::regclass
          AND polcmd <> 'r'
      ),
    'row security with a select policy only'
  ) || E'\n';

  v_report := v_report || pg_temp.passfail(
    10,
    'litre remains an allowed catalogue unit',
    EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'materials_purchase_unit_check'
        AND pg_get_constraintdef(oid) ILIKE '%litre%'
    )
      AND EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'material_prices_price_unit_check'
          AND pg_get_constraintdef(oid) ILIKE '%litre%'
      ),
    'materials and material_prices checks include litre'
  ) || E'\n';

  SELECT pg_get_functiondef(proc.oid) INTO v_def
  FROM pg_proc AS proc
  JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'create_bulk_material_from_invoice_lines';

  v_report := v_report || pg_temp.passfail(
    11,
    'create function locks identity and handles unique conflicts',
    v_def ILIKE '%pg_advisory_xact_lock%' AND v_def ILIKE '%unique_violation%',
    'applied function body'
  ) || E'\n';

  SELECT pg_get_functiondef(proc.oid) INTO v_def
  FROM pg_proc AS proc
  JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'retain_bulk_historical_invoice_prices';

  v_report := v_report || pg_temp.passfail(
    12,
    'historical retention writes history and no current price',
    v_def ILIKE '%INSERT INTO public.supplier_invoice_historical_prices%'
      AND strpos(v_def, 'INSERT INTO public.material_prices') = 0,
    'applied retain function body'
  ) || E'\n';

  SELECT pg_get_functiondef(proc.oid) INTO v_def
  FROM pg_proc AS proc
  JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'accept_bulk_rounding_discrepancy';

  v_report := v_report || pg_temp.passfail(
    13,
    'rounding function leaves raw invoice amounts alone',
    v_def ILIKE '%rounding_discrepancy%'
      AND strpos(v_def, 'raw_quantity =') = 0
      AND strpos(v_def, 'raw_unit_price =') = 0
      AND strpos(v_def, 'raw_line_total =') = 0
      AND strpos(v_def, 'subtotal =') = 0,
    'applied rounding function body'
  ) || E'\n';

  IF NOT v_can_write THEN
    v_report := v_report || pg_temp.passfail(20, 'disposable action tests', false, 'admin identity was not active, so no invoice actions were attempted') || E'\n';
  ELSE
    v_token := 'zz-bulk-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    PERFORM pg_temp.keep('admin', v_admin);

    INSERT INTO public.suppliers (name, normalized_name)
    VALUES ('ZZ Bulk Review Validation ' || v_token, 'placeholder')
    RETURNING id INTO v_admin;

    PERFORM pg_temp.keep('supplier', v_admin);
    v_admin := pg_temp.fid('admin');

    PERFORM pg_temp.make_invoice('delivery-a', v_token || '-delivery-a', DATE '2024-05-01');
    PERFORM pg_temp.make_invoice('delivery-b', v_token || '-delivery-b', DATE '2024-05-02');
    PERFORM pg_temp.make_line('delivery-1', 'delivery-a', 1, 'Standard delivery', 1, NULL, 12.00, 12.00, 'unmatched', NULL, NULL, NULL);
    PERFORM pg_temp.make_line('delivery-2', 'delivery-b', 1, 'Next day carriage', 1, NULL, 8.50, 8.50, 'needs_review', NULL, NULL, NULL);

    PERFORM pg_temp.make_invoice('rollback-invoice', v_token || '-rollback', DATE '2024-05-03');
    PERFORM pg_temp.make_line('rollback-charge', 'rollback-invoice', 1, 'Freight', 1, NULL, 6.00, 6.00, 'unmatched', NULL, NULL, NULL);
    PERFORM pg_temp.make_line('rollback-vinyl', 'rollback-invoice', 2, 'White gloss vinyl 1370mm', 1, 'roll', 40.00, 40.00, 'unmatched', NULL, NULL, NULL);

    PERFORM pg_temp.make_product('confirm-material', 'confirm-product', 'confirm-price', 'ZZ Confirm Sheet ' || v_token, 'sheet', 'ZZ confirm sheet ' || v_token, 10.00, DATE '2026-01-01');
    PERFORM pg_temp.make_invoice('confirm-a', v_token || '-confirm-a', DATE '2024-06-01');
    PERFORM pg_temp.make_invoice('confirm-b', v_token || '-confirm-b', DATE '2024-06-02');
    PERFORM pg_temp.make_line('confirm-1', 'confirm-a', 1, 'Existing sheet one', 2, 'sheet', 10.00, 20.00, 'unmatched', NULL, NULL, NULL);
    PERFORM pg_temp.make_line('confirm-2', 'confirm-b', 1, 'Existing sheet two', 1, 'sheets', 10.00, 10.00, 'needs_review', NULL, NULL, NULL);

    PERFORM pg_temp.make_product('history-material', 'history-product', 'history-price', 'ZZ History Sheet ' || v_token, 'sheet', 'ZZ history sheet ' || v_token, 42.00, DATE '2026-01-01');
    PERFORM pg_temp.make_invoice('history-a', v_token || '-history-a', DATE '2024-03-01');
    PERFORM pg_temp.make_invoice('history-b', v_token || '-history-b', DATE '2024-03-02');
    PERFORM pg_temp.make_line('history-1', 'history-a', 1, 'Historical sheet one', 1, 'sheet', 25.34, 25.34, 'price_change', NULL, 'history-product', 'high');
    PERFORM pg_temp.make_line('history-2', 'history-b', 1, 'Historical sheet two', 2, 'sheet', 25.34, 50.68, 'price_change', NULL, 'history-product', 'high');

    PERFORM pg_temp.make_product('approve-material', 'approve-product', 'approve-price', 'ZZ Approve Sheet ' || v_token, 'sheet', 'ZZ approve sheet ' || v_token, 10.00, DATE '2026-01-01');
    PERFORM pg_temp.make_invoice('approve-a', v_token || '-approve-a', DATE '2026-02-01');
    PERFORM pg_temp.make_invoice('approve-b', v_token || '-approve-b', DATE '2026-02-02');
    PERFORM pg_temp.make_line('approve-1', 'approve-a', 1, 'Approve sheet one', 1, 'sheet', 15.50, 15.50, 'price_change', NULL, 'approve-product', 'high');
    PERFORM pg_temp.make_line('approve-2', 'approve-b', 1, 'Approve sheet two', 2, 'sheet', 15.50, 31.00, 'price_change', NULL, 'approve-product', 'high');

    PERFORM pg_temp.make_invoice('litre-a', v_token || '-litre-a', DATE '2024-07-01');
    PERFORM pg_temp.make_invoice('litre-b', v_token || '-litre-b', DATE '2024-07-02');
    PERFORM pg_temp.make_line('litre-1', 'litre-a', 1, '770 UV Yellow Ink 1 litre', 1, NULL, 84.45, 84.45, 'unmatched', NULL, NULL, NULL);
    PERFORM pg_temp.make_line('litre-2', 'litre-b', 1, '770 UV Yellow Ink 1 litre', 2, NULL, 84.45, 168.90, 'needs_review', NULL, NULL, NULL);

    PERFORM pg_temp.make_invoice('create-a', v_token || '-create-a', DATE '2024-08-01');
    PERFORM pg_temp.make_invoice('create-b', v_token || '-create-b', DATE '2024-08-02');
    PERFORM pg_temp.make_invoice('create-dup', v_token || '-create-dup', DATE '2024-08-03');
    PERFORM pg_temp.make_line('create-1', 'create-a', 1, 'ZZ new litre ink ' || v_token || ' 1 litre', 1, NULL, 19.00, 19.00, 'unmatched', NULL, NULL, NULL);
    PERFORM pg_temp.make_line('create-2', 'create-b', 1, 'ZZ new litre ink ' || v_token || ' 1 litre', 1, NULL, 19.00, 19.00, 'needs_review', NULL, NULL, NULL);
    PERFORM pg_temp.make_line('create-dup-line', 'create-dup', 1, 'ZZ new litre ink ' || v_token || ' duplicate', 1, NULL, 19.00, 19.00, 'unmatched', NULL, NULL, NULL);

    PERFORM pg_temp.make_invoice('round-invoice', v_token || '-round', DATE '2024-09-01');
    PERFORM pg_temp.make_line('round-line', 'round-invoice', 1, 'Rounding two pence', 2, 'sheet', 254.42, 508.82, 'extraction_error', 'Quantity x unit price is 508.84, but the line total is 508.82.', NULL, NULL);
    PERFORM pg_temp.make_invoice('wide-invoice', v_token || '-wide', DATE '2024-09-02');
    PERFORM pg_temp.make_line('wide-line', 'wide-invoice', 1, 'Rounding three pence', 1, 'sheet', 10.00, 10.03, 'extraction_error', 'Quantity x unit price is 10.00, but the line total is 10.03.', NULL, NULL);

    BEGIN
      PERFORM public.ignore_bulk_invoice_charges(
        ARRAY[pg_temp.fid('rollback-charge'), pg_temp.fid('rollback-vinyl')],
        v_admin
      );
      v_raised := false;
      v_detail := 'call succeeded';
    EXCEPTION
      WHEN OTHERS THEN
        v_raised := true;
        v_detail := SQLERRM;
    END;

    v_report := v_report || pg_temp.passfail(
      20,
      'failed charge ignore rolls the valid line back',
      v_raised
        AND v_detail ILIKE '%not a non-material charge%'
        AND EXISTS (
          SELECT 1 FROM public.supplier_invoice_lines
          WHERE id = pg_temp.fid('rollback-charge')
            AND review_status = 'unmatched'
            AND raw_description = 'Freight'
            AND raw_unit_price = 6.00
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.supplier_invoice_events
          WHERE invoice_line_id IN (pg_temp.fid('rollback-charge'), pg_temp.fid('rollback-vinyl'))
        ),
      v_detail
    ) || E'\n';

    BEGIN
      v_json := public.ignore_bulk_invoice_charges(
        ARRAY[pg_temp.fid('delivery-1'), pg_temp.fid('delivery-2')],
        v_admin
      );
      v_detail := v_json::text;
      v_raised := false;
    EXCEPTION
      WHEN OTHERS THEN
        v_raised := true;
        v_detail := SQLSTATE || ' ' || SQLERRM;
        v_json := NULL;
    END;

    v_report := v_report || pg_temp.passfail(
      21,
      'ignore multiple delivery charges',
      NOT v_raised
        AND coalesce(v_json->>'alreadyResolved', '') = 'false'
        AND (
          SELECT count(*) FROM public.supplier_invoice_lines
          WHERE id IN (pg_temp.fid('delivery-1'), pg_temp.fid('delivery-2'))
            AND review_status = 'ignored'
            AND raw_description IN ('Standard delivery', 'Next day carriage')
            AND raw_unit_price IN (12.00, 8.50)
        ) = 2
        AND (
          SELECT count(*) FROM public.supplier_invoice_events
          WHERE invoice_line_id IN (pg_temp.fid('delivery-1'), pg_temp.fid('delivery-2'))
            AND action = 'line_ignored'
            AND actor_id = v_admin
            AND metadata->>'bulk' = 'true'
            AND metadata->>'futureRule' = 'false'
        ) = 2
        AND NOT EXISTS (
          SELECT 1 FROM public.supplier_invoice_ignore_rules
          WHERE supplier_id = pg_temp.fid('supplier')
        ),
      v_detail
    ) || E'\n';

    BEGIN
      v_json := public.ignore_bulk_invoice_charges(
        ARRAY[pg_temp.fid('delivery-1'), pg_temp.fid('delivery-2')],
        v_admin
      );
      v_detail := v_json::text;
      v_raised := false;
    EXCEPTION
      WHEN OTHERS THEN
        v_raised := true;
        v_detail := SQLSTATE || ' ' || SQLERRM;
        v_json := NULL;
    END;

    v_report := v_report || pg_temp.passfail(
      22,
      'repeated charge ignore is idempotent',
      NOT v_raised
        AND coalesce(v_json->>'alreadyResolved', '') = 'true'
        AND (
          SELECT count(*) FROM public.supplier_invoice_events
          WHERE invoice_line_id IN (pg_temp.fid('delivery-1'), pg_temp.fid('delivery-2'))
            AND action = 'line_ignored'
        ) = 2,
      v_detail
    ) || E'\n';

    BEGIN
      v_json := public.confirm_bulk_invoice_products(
        ARRAY[pg_temp.fid('confirm-1'), pg_temp.fid('confirm-2')],
        pg_temp.fid('confirm-product'),
        v_admin
      );
      v_detail := v_json::text;
      v_raised := false;
    EXCEPTION
      WHEN OTHERS THEN
        v_raised := true;
        v_detail := SQLSTATE || ' ' || SQLERRM;
        v_json := NULL;
    END;

    v_report := v_report || pg_temp.passfail(
      23,
      'confirm an existing product across invoices',
      NOT v_raised
        AND coalesce(v_json->>'alreadyResolved', '') = 'false'
        AND (
          SELECT count(*) FROM public.supplier_invoice_lines
          WHERE id IN (pg_temp.fid('confirm-1'), pg_temp.fid('confirm-2'))
            AND matched_supplier_product_id = pg_temp.fid('confirm-product')
            AND match_confidence = 'high'
            AND review_status = 'processed'
            AND raw_unit_price = 10.00
        ) = 2
        AND (
          SELECT count(*) FROM public.material_prices
          WHERE material_supplier_product_id = pg_temp.fid('confirm-product')
        ) = 1
        AND NOT EXISTS (
          SELECT 1 FROM public.supplier_product_description_mappings
          WHERE supplier_id = pg_temp.fid('supplier')
        ),
      v_detail
    ) || E'\n';

    BEGIN
      v_json := public.confirm_bulk_invoice_products(
        ARRAY[pg_temp.fid('confirm-1'), pg_temp.fid('confirm-2')],
        pg_temp.fid('confirm-product'),
        v_admin
      );
      v_detail := v_json::text;
      v_raised := false;
    EXCEPTION
      WHEN OTHERS THEN
        v_raised := true;
        v_detail := SQLSTATE || ' ' || SQLERRM;
        v_json := NULL;
    END;

    v_report := v_report || pg_temp.passfail(
      24,
      'repeated product confirmation is idempotent',
      NOT v_raised AND coalesce(v_json->>'alreadyResolved', '') = 'true',
      v_detail
    ) || E'\n';

    SELECT price INTO v_price
    FROM public.material_prices
    WHERE id = pg_temp.fid('history-price');

    BEGIN
      v_json := public.retain_bulk_historical_invoice_prices(
        ARRAY[pg_temp.fid('history-1'), pg_temp.fid('history-2')],
        pg_temp.fid('history-product'),
        pg_temp.fid('history-price'),
        25.34,
        v_admin
      );
      v_detail := v_json::text;
      v_raised := false;
    EXCEPTION
      WHEN OTHERS THEN
        v_raised := true;
        v_detail := SQLSTATE || ' ' || SQLERRM;
        v_json := NULL;
    END;

    v_report := v_report || pg_temp.passfail(
      25,
      'record historical prices without changing the current price',
      NOT v_raised
        AND coalesce(v_json->>'alreadyResolved', '') = 'false'
        AND v_price = 42.00
        AND (
          SELECT count(*) FROM public.material_prices
          WHERE material_supplier_product_id = pg_temp.fid('history-product')
        ) = 1
        AND (
          SELECT price FROM public.material_prices WHERE id = pg_temp.fid('history-price')
        ) = 42.00
        AND (
          SELECT count(*) FROM public.supplier_invoice_historical_prices
          WHERE invoice_line_id IN (pg_temp.fid('history-1'), pg_temp.fid('history-2'))
            AND invoice_price = 25.34
            AND retained_current_price_id = pg_temp.fid('history-price')
            AND retained_current_price = 42.00
            AND recorded_by = v_admin
        ) = 2
        AND (
          SELECT count(*) FROM public.supplier_invoice_lines
          WHERE id IN (pg_temp.fid('history-1'), pg_temp.fid('history-2'))
            AND review_status = 'processed'
            AND raw_unit_price = 25.34
        ) = 2,
      v_detail
    ) || E'\n';

    BEGIN
      v_json := public.retain_bulk_historical_invoice_prices(
        ARRAY[pg_temp.fid('history-1'), pg_temp.fid('history-2')],
        pg_temp.fid('history-product'),
        pg_temp.fid('history-price'),
        25.34,
        v_admin
      );
      v_detail := v_json::text;
      v_raised := false;
    EXCEPTION
      WHEN OTHERS THEN
        v_raised := true;
        v_detail := SQLSTATE || ' ' || SQLERRM;
        v_json := NULL;
    END;

    v_report := v_report || pg_temp.passfail(
      26,
      'repeated historical recording is idempotent',
      NOT v_raised
        AND coalesce(v_json->>'alreadyResolved', '') = 'true'
        AND (
          SELECT count(*) FROM public.supplier_invoice_historical_prices
          WHERE invoice_line_id IN (pg_temp.fid('history-1'), pg_temp.fid('history-2'))
        ) = 2
        AND (
          SELECT count(*) FROM public.material_prices
          WHERE material_supplier_product_id = pg_temp.fid('history-product')
        ) = 1,
      v_detail
    ) || E'\n';

    BEGIN
      v_json := public.approve_bulk_invoice_price(
        ARRAY[pg_temp.fid('approve-1'), pg_temp.fid('approve-2')],
        pg_temp.fid('approve-product'),
        pg_temp.fid('approve-price'),
        15.50,
        v_admin
      );
      v_detail := v_json::text;
      v_raised := false;
    EXCEPTION
      WHEN OTHERS THEN
        v_raised := true;
        v_detail := SQLSTATE || ' ' || SQLERRM;
        v_json := NULL;
    END;

    v_report := v_report || pg_temp.passfail(
      27,
      'explicit approval adds one current price and keeps the old price',
      NOT v_raised
        AND coalesce(v_json->>'priceCount', '') = '1'
        AND (
          SELECT price FROM public.material_prices WHERE id = pg_temp.fid('approve-price')
        ) = 10.00
        AND (
          SELECT count(*) FROM public.material_prices
          WHERE material_supplier_product_id = pg_temp.fid('approve-product')
            AND price = 15.50
            AND effective_date = current_date
        ) = 1
        AND (
          SELECT count(*) FROM public.supplier_invoice_lines
          WHERE id IN (pg_temp.fid('approve-1'), pg_temp.fid('approve-2'))
            AND review_status = 'processed'
            AND raw_unit_price = 15.50
        ) = 2
        AND (
          SELECT count(*) FROM public.supplier_invoice_events
          WHERE invoice_line_id IN (pg_temp.fid('approve-1'), pg_temp.fid('approve-2'))
            AND action = 'price_change_approved'
            AND metadata->>'bulk' = 'true'
            AND metadata->>'priceCount' = '1'
        ) = 2,
      v_detail
    ) || E'\n';

    BEGIN
      v_json := public.approve_bulk_invoice_price(
        ARRAY[pg_temp.fid('approve-1'), pg_temp.fid('approve-2')],
        pg_temp.fid('approve-product'),
        pg_temp.fid('approve-price'),
        15.50,
        v_admin
      );
      v_detail := v_json::text;
      v_raised := false;
    EXCEPTION
      WHEN OTHERS THEN
        v_raised := true;
        v_detail := SQLSTATE || ' ' || SQLERRM;
        v_json := NULL;
    END;

    v_report := v_report || pg_temp.passfail(
      28,
      'repeated price approval is idempotent',
      NOT v_raised
        AND coalesce(v_json->>'alreadyResolved', '') = 'true'
        AND (
          SELECT count(*) FROM public.material_prices
          WHERE material_supplier_product_id = pg_temp.fid('approve-product')
        ) = 2,
      v_detail
    ) || E'\n';

    BEGIN
      v_json := public.set_bulk_invoice_purchase_units(
        ARRAY[pg_temp.fid('litre-1'), pg_temp.fid('litre-2')],
        'litre',
        v_admin
      );
      v_detail := v_json::text;
      v_raised := false;
    EXCEPTION
      WHEN OTHERS THEN
        v_raised := true;
        v_detail := SQLSTATE || ' ' || SQLERRM;
        v_json := NULL;
    END;

    v_report := v_report || pg_temp.passfail(
      29,
      'set litre on ink lines without recalculating prices',
      NOT v_raised
        AND coalesce(v_json->>'unit', '') = 'litre'
        AND (
          SELECT count(*) FROM public.supplier_invoice_lines
          WHERE id IN (pg_temp.fid('litre-1'), pg_temp.fid('litre-2'))
            AND reviewed_unit = 'litre'
            AND raw_unit IS NULL
            AND raw_unit_price = 84.45
            AND raw_description = '770 UV Yellow Ink 1 litre'
        ) = 2,
      v_detail
    ) || E'\n';

    BEGIN
      v_json := public.set_bulk_invoice_purchase_units(
        ARRAY[pg_temp.fid('litre-1'), pg_temp.fid('litre-2')],
        'litre',
        v_admin
      );
      v_detail := v_json::text;
      v_raised := false;
    EXCEPTION
      WHEN OTHERS THEN
        v_raised := true;
        v_detail := SQLSTATE || ' ' || SQLERRM;
        v_json := NULL;
    END;

    v_report := v_report || pg_temp.passfail(
      30,
      'repeated litre unit save is idempotent',
      NOT v_raised AND coalesce(v_json->>'alreadyResolved', '') = 'true',
      v_detail
    ) || E'\n';

    BEGIN
      v_json := public.create_bulk_material_from_invoice_lines(
        ARRAY[pg_temp.fid('create-1'), pg_temp.fid('create-2')],
        v_admin,
        'ZZ Bulk Review Litre ' || v_token,
        'litre',
        NULL,
        NULL,
        NULL,
        NULL,
        19.00
      );
      v_detail := v_json::text;
      v_raised := false;
    EXCEPTION
      WHEN OTHERS THEN
        v_raised := true;
        v_detail := SQLSTATE || ' ' || SQLERRM;
        v_json := NULL;
    END;

    v_report := v_report || pg_temp.passfail(
      31,
      'create one litre material from repeated invoice lines',
      NOT v_raised
        AND coalesce(v_json->>'alreadyResolved', '') = 'false'
        AND (
          SELECT count(*) FROM public.materials
          WHERE name = 'ZZ Bulk Review Litre ' || v_token
            AND purchase_unit = 'litre'
        ) = 1
        AND (
          SELECT count(*) FROM public.material_supplier_products
          WHERE supplier_id = pg_temp.fid('supplier')
            AND supplier_description = 'ZZ Bulk Review Litre ' || v_token
            AND is_preferred = false
        ) = 1
        AND (
          SELECT count(*) FROM public.material_prices AS price
          JOIN public.material_supplier_products AS product ON product.id = price.material_supplier_product_id
          WHERE product.supplier_id = pg_temp.fid('supplier')
            AND product.supplier_description = 'ZZ Bulk Review Litre ' || v_token
            AND price.price = 19.00
            AND price.price_unit = 'litre'
        ) = 1
        AND (
          SELECT count(*) FROM public.supplier_invoice_lines
          WHERE id IN (pg_temp.fid('create-1'), pg_temp.fid('create-2'))
            AND review_status = 'processed'
            AND raw_description = 'ZZ new litre ink ' || v_token || ' 1 litre'
            AND raw_unit_price = 19.00
        ) = 2
        AND NOT EXISTS (
          SELECT 1 FROM public.supplier_product_description_mappings
          WHERE supplier_id = pg_temp.fid('supplier')
        ),
      v_detail
    ) || E'\n';

    BEGIN
      v_json := public.create_bulk_material_from_invoice_lines(
        ARRAY[pg_temp.fid('create-1'), pg_temp.fid('create-2')],
        v_admin,
        'ZZ Bulk Review Litre ' || v_token,
        'litre',
        NULL,
        NULL,
        NULL,
        NULL,
        19.00
      );
      v_detail := v_json::text;
      v_raised := false;
    EXCEPTION
      WHEN OTHERS THEN
        v_raised := true;
        v_detail := SQLSTATE || ' ' || SQLERRM;
        v_json := NULL;
    END;

    v_report := v_report || pg_temp.passfail(
      32,
      'repeated material creation is idempotent',
      NOT v_raised
        AND coalesce(v_json->>'alreadyResolved', '') = 'true'
        AND (
          SELECT count(*) FROM public.materials
          WHERE name = 'ZZ Bulk Review Litre ' || v_token
        ) = 1,
      v_detail
    ) || E'\n';

    BEGIN
      PERFORM public.create_bulk_material_from_invoice_lines(
        ARRAY[pg_temp.fid('create-dup-line')],
        v_admin,
        'ZZ Bulk Review Litre ' || v_token,
        'litre',
        NULL,
        NULL,
        NULL,
        NULL,
        19.00
      );
      v_raised := false;
      v_detail := 'call succeeded';
    EXCEPTION
      WHEN OTHERS THEN
        v_raised := true;
        v_detail := SQLERRM;
    END;

    v_report := v_report || pg_temp.passfail(
      33,
      'concurrent duplicate material creation rolls back',
      v_raised
        AND v_detail ILIKE '%already%'
        AND EXISTS (
          SELECT 1 FROM public.supplier_invoice_lines
          WHERE id = pg_temp.fid('create-dup-line')
            AND review_status = 'unmatched'
            AND matched_supplier_product_id IS NULL
        )
        AND (
          SELECT count(*) FROM public.materials
          WHERE name = 'ZZ Bulk Review Litre ' || v_token
        ) = 1,
      v_detail
    ) || E'\n';

    SELECT subtotal, vat, total INTO v_subtotal, v_vat, v_total
    FROM public.supplier_invoices
    WHERE id = pg_temp.fid('round-invoice');

    SELECT raw_description, raw_quantity, raw_unit, raw_unit_price, raw_line_total
    INTO v_raw_description, v_raw_quantity, v_raw_unit, v_raw_unit_price, v_raw_line_total
    FROM public.supplier_invoice_lines
    WHERE id = pg_temp.fid('round-line');

    BEGIN
      v_json := public.accept_bulk_rounding_discrepancy(
        ARRAY[pg_temp.fid('round-line')],
        v_admin
      );
      v_detail := v_json::text;
      v_raised := false;
    EXCEPTION
      WHEN OTHERS THEN
        v_raised := true;
        v_detail := SQLSTATE || ' ' || SQLERRM;
        v_json := NULL;
    END;

    v_report := v_report || pg_temp.passfail(
      34,
      'accept a 2p rounding difference without changing invoice figures',
      NOT v_raised
        AND coalesce(v_json->>'changesInvoiceTotals', '') = 'false'
        AND v_subtotal = 100 AND v_vat = 20 AND v_total = 120
        AND EXISTS (
          SELECT 1
          FROM public.supplier_invoices
          WHERE id = pg_temp.fid('round-invoice')
            AND subtotal = v_subtotal
            AND vat = v_vat
            AND total = v_total
        )
        AND EXISTS (
          SELECT 1
          FROM public.supplier_invoice_lines
          WHERE id = pg_temp.fid('round-line')
            AND review_status = 'needs_review'
            AND maths_warning IS NULL
            AND raw_description = v_raw_description
            AND raw_quantity = v_raw_quantity
            AND raw_unit IS NOT DISTINCT FROM v_raw_unit
            AND raw_unit_price = v_raw_unit_price
            AND raw_line_total = v_raw_line_total
        )
        AND EXISTS (
          SELECT 1
          FROM public.supplier_invoice_events
          WHERE invoice_line_id = pg_temp.fid('round-line')
            AND action = 'line_corrected'
            AND actor_id = v_admin
            AND metadata->>'rule' = 'rounding_discrepancy'
            AND metadata->>'changesInvoiceTotals' = 'false'
            AND (metadata->>'difference')::numeric = 0.02
        ),
      v_detail
    ) || E'\n';

    BEGIN
      v_json := public.accept_bulk_rounding_discrepancy(
        ARRAY[pg_temp.fid('round-line')],
        v_admin
      );
      v_detail := v_json::text;
      v_raised := false;
    EXCEPTION
      WHEN OTHERS THEN
        v_raised := true;
        v_detail := SQLSTATE || ' ' || SQLERRM;
        v_json := NULL;
    END;

    v_report := v_report || pg_temp.passfail(
      35,
      'repeated rounding acceptance is idempotent',
      NOT v_raised
        AND coalesce(v_json->>'alreadyResolved', '') = 'true'
        AND (
          SELECT count(*) FROM public.supplier_invoice_events
          WHERE invoice_line_id = pg_temp.fid('round-line')
            AND action = 'line_corrected'
            AND metadata->>'rule' = 'rounding_discrepancy'
        ) = 1,
      v_detail
    ) || E'\n';

    BEGIN
      PERFORM public.accept_bulk_rounding_discrepancy(ARRAY[pg_temp.fid('wide-line')], v_admin);
      v_raised := false;
      v_detail := 'call succeeded';
    EXCEPTION
      WHEN OTHERS THEN
        v_raised := true;
        v_detail := SQLERRM;
    END;

    v_report := v_report || pg_temp.passfail(
      36,
      'a 3p difference stays a repair and keeps its original amounts',
      v_raised
        AND v_detail ILIKE '%1p or 2p%'
        AND EXISTS (
          SELECT 1 FROM public.supplier_invoice_lines
          WHERE id = pg_temp.fid('wide-line')
            AND review_status = 'extraction_error'
            AND raw_line_total = 10.03
            AND maths_warning IS NOT NULL
        ),
      v_detail
    ) || E'\n';

    v_report := v_report || pg_temp.passfail(
      37,
      'original invoice totals and raw line amounts stay in place',
      NOT EXISTS (
        SELECT 1
        FROM public.supplier_invoices
        WHERE supplier_id = pg_temp.fid('supplier')
          AND (subtotal IS DISTINCT FROM 100 OR vat IS DISTINCT FROM 20 OR total IS DISTINCT FROM 120)
      )
        AND EXISTS (
          SELECT 1 FROM public.supplier_invoice_lines
          WHERE id = pg_temp.fid('delivery-1')
            AND raw_description = 'Standard delivery'
            AND raw_line_total = 12.00
        )
        AND EXISTS (
          SELECT 1 FROM public.supplier_invoice_lines
          WHERE id = pg_temp.fid('history-2')
            AND raw_description = 'Historical sheet two'
            AND raw_line_total = 50.68
        ),
      'header totals and sampled raw lines'
    ) || E'\n';

    v_report := v_report || pg_temp.passfail(
      38,
      'audit events record the admin and no future rule was stored',
      (
        SELECT count(*) FROM public.supplier_invoice_events AS event
        JOIN public.supplier_invoices AS invoice ON invoice.id = event.invoice_id
        WHERE invoice.supplier_id = pg_temp.fid('supplier')
          AND event.actor_id = v_admin
          AND event.metadata->>'futureRule' = 'false'
      ) >= 8
        AND NOT EXISTS (
          SELECT 1 FROM public.supplier_invoice_ignore_rules
          WHERE supplier_id = pg_temp.fid('supplier')
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.supplier_product_description_mappings
          WHERE supplier_id = pg_temp.fid('supplier')
        ),
      'events kept; ignore rules and description mappings absent'
    ) || E'\n';
  END IF;

  FOR v_rec IN
    SELECT step, result, check_name, detail
    FROM bulk_review_validation_results
    ORDER BY step
  LOOP
    RAISE NOTICE '% % — % — %', v_rec.step, v_rec.result, v_rec.check_name, v_rec.detail;
  END LOOP;

  RAISE NOTICE 'OVERALL %',
    CASE
      WHEN EXISTS (SELECT 1 FROM bulk_review_validation_results WHERE result <> 'PASS') THEN 'FAIL'
      ELSE 'PASS'
    END;
EXCEPTION
  WHEN OTHERS THEN
    BEGIN
      v_report := v_report || pg_temp.passfail(900, 'validation script', false, SQLSTATE || ' ' || SQLERRM) || E'\n';
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION E'OVERALL FAIL\nThe validation stopped before the failing check could be stored.\n%\n%\n%',
          SQLSTATE, SQLERRM, coalesce(v_report, '');
    END;
END;

  IF coalesce(v_report, '') !~ ('(^|\n)[0-9]+' || E'\t(PASS|FAIL)\t') THEN
    v_overall := 'FAIL';
    v_report := coalesce(v_report, '') || E'none\tFAIL\tvalidation script\tno checks recorded\n';
  ELSIF v_report ~ ('(^|\n)[0-9]+' || E'\tFAIL\t') THEN
    v_overall := 'FAIL';
  ELSE
    v_overall := 'PASS';
  END IF;

  RAISE EXCEPTION E'OVERALL %\nDisposable Test rows are rolled back with this error. No invoices, materials, prices, or events are kept.\n\nstep\tresult\tcheck\tdetail\n%\n\nOVERALL %\nA red error is expected. It is the validation report, and it prevents these writes from being committed.',
    v_overall, v_report, v_overall;
END;
$validation$;
