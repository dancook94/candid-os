-- Replace supplier_sku_details_conflict after the Test installation of
-- 20261027143000_supplier_sku_confirmation.sql.
-- text[] || 'foamalite' is parsed as an array literal and raises
-- malformed array literal. array_append stores one family name.
-- This does not change tables, grants, prices, products, or invoices.
-- Apply manually to the Test project only. Do not push it from config.toml.

BEGIN;

CREATE OR REPLACE FUNCTION public.supplier_sku_details_conflict(
  p_invoice_description text,
  p_product_text text,
  p_thickness_mm numeric,
  p_width_mm numeric,
  p_height_mm numeric,
  p_length_mm numeric
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_invoice text := lower(COALESCE(p_invoice_description, ''));
  v_product text := lower(COALESCE(p_product_text, ''));
  v_invoice_families text[] := ARRAY[]::text[];
  v_product_families text[] := ARRAY[]::text[];
  v_invoice_grades text[] := ARRAY[]::text[];
  v_product_grades text[] := ARRAY[]::text[];
  v_without text;
  v_thickness numeric;
  v_pair_count integer;
  v_left numeric;
  v_right numeric;
  v_product_left numeric;
  v_product_right numeric;
  v_roll_count integer;
  v_roll_width numeric;
  v_roll_length numeric;
  v_invoice_permanent boolean;
  v_invoice_removable boolean;
  v_product_permanent boolean;
  v_product_removable boolean;
BEGIN
  IF v_invoice ~ '\m(foamalite|foamex)\M' OR v_invoice ~ 'foam pvc' THEN
    v_invoice_families := pg_catalog.array_append(v_invoice_families, 'foamalite');
  END IF;
  IF v_invoice ~ '\m(dibond|acm)\M' OR v_invoice ~ 'aluminium composite' OR v_invoice ~ 'aluminum composite' THEN
    v_invoice_families := pg_catalog.array_append(v_invoice_families, 'dibond');
  END IF;
  IF v_invoice ~ '\m(acrylic|perspex|plexiglass)\M' THEN
    v_invoice_families := pg_catalog.array_append(v_invoice_families, 'acrylic');
  END IF;
  IF v_invoice ~ '\m(vinyl|briteline|monomeric|polymeric)\M' THEN
    v_invoice_families := pg_catalog.array_append(v_invoice_families, 'vinyl');
  END IF;
  IF v_invoice ~ '\mbanner\M' THEN
    v_invoice_families := pg_catalog.array_append(v_invoice_families, 'banner');
  END IF;
  IF v_invoice ~ '\mpaper\M' THEN
    v_invoice_families := pg_catalog.array_append(v_invoice_families, 'paper');
  END IF;
  IF v_invoice ~ '\m(fabric|textile)\M' THEN
    v_invoice_families := pg_catalog.array_append(v_invoice_families, 'fabric');
  END IF;

  IF v_product ~ '\m(foamalite|foamex)\M' OR v_product ~ 'foam pvc' THEN
    v_product_families := pg_catalog.array_append(v_product_families, 'foamalite');
  END IF;
  IF v_product ~ '\m(dibond|acm)\M' OR v_product ~ 'aluminium composite' OR v_product ~ 'aluminum composite' THEN
    v_product_families := pg_catalog.array_append(v_product_families, 'dibond');
  END IF;
  IF v_product ~ '\m(acrylic|perspex|plexiglass)\M' THEN
    v_product_families := pg_catalog.array_append(v_product_families, 'acrylic');
  END IF;
  IF v_product ~ '\m(vinyl|briteline|monomeric|polymeric)\M' THEN
    v_product_families := pg_catalog.array_append(v_product_families, 'vinyl');
  END IF;
  IF v_product ~ '\mbanner\M' THEN
    v_product_families := pg_catalog.array_append(v_product_families, 'banner');
  END IF;
  IF v_product ~ '\mpaper\M' THEN
    v_product_families := pg_catalog.array_append(v_product_families, 'paper');
  END IF;
  IF v_product ~ '\m(fabric|textile)\M' THEN
    v_product_families := pg_catalog.array_append(v_product_families, 'fabric');
  END IF;

  IF cardinality(v_invoice_families) = 1
    AND cardinality(v_product_families) = 1
    AND v_invoice_families[1] IS DISTINCT FROM v_product_families[1]
  THEN
    RETURN true;
  END IF;

  SELECT COALESCE(array_agg(token), ARRAY[]::text[])
  INTO v_invoice_grades
  FROM (
    SELECT 'pq' || lower(match[1]) AS token
    FROM regexp_matches(COALESCE(p_invoice_description, ''), 'PQ\s*([0-9]+)', 'gi') AS match
    UNION
    SELECT 'fg-' || lower(match[1])
    FROM regexp_matches(COALESCE(p_invoice_description, ''), 'FG-([0-9]+)', 'gi') AS match
  ) AS grades;

  SELECT COALESCE(array_agg(token), ARRAY[]::text[])
  INTO v_product_grades
  FROM (
    SELECT 'pq' || lower(match[1]) AS token
    FROM regexp_matches(COALESCE(p_product_text, ''), 'PQ\s*([0-9]+)', 'gi') AS match
    UNION
    SELECT 'fg-' || lower(match[1])
    FROM regexp_matches(COALESCE(p_product_text, ''), 'FG-([0-9]+)', 'gi') AS match
  ) AS grades;

  IF cardinality(v_invoice_grades) > 0
    AND cardinality(v_product_grades) > 0
    AND NOT (v_invoice_grades && v_product_grades)
  THEN
    RETURN true;
  END IF;

  v_without := regexp_replace(
    COALESCE(p_invoice_description, ''),
    '([0-9]+(\.[0-9]+)?)[[:space:]]*(mm)?[[:space:]]*[x×][[:space:]]*([0-9]+(\.[0-9]+)?)[[:space:]]*(mm)?',
    ' ',
    'gi'
  );
  v_thickness := substring(v_without from '([0-9]+(\.[0-9]+)?)[[:space:]]*mm')::numeric;

  IF v_thickness IS NOT NULL
    AND v_thickness > 0
    AND v_thickness <= 100
    AND p_thickness_mm IS NOT NULL
    AND abs(v_thickness - p_thickness_mm) >= 0.15
  THEN
    RETURN true;
  END IF;

  IF p_width_mm IS NOT NULL AND p_invoice_description ~* 'slit to\s+[0-9]' THEN
    IF EXISTS (
      SELECT 1
      FROM regexp_matches(p_invoice_description, 'slit to[[:space:]]+([0-9]{3,4}(\.[0-9]+)?)[[:space:]]*mm', 'gi') AS match
      WHERE round(match[1]::numeric) <> round(p_width_mm)
    ) THEN
      RETURN true;
    END IF;
  END IF;

  -- Sheet sizes include 1220mm x 2440mm, 1220mm x 2440 and 2440 x 1220mm.
  -- Roll sizes include 1370mm x 50m and 50m x 1370mm.
  SELECT count(*)
  INTO v_pair_count
  FROM (
    SELECT DISTINCT
      least(round(match[1]::numeric), round(match[3]::numeric)) AS low_mm,
      greatest(round(match[1]::numeric), round(match[3]::numeric)) AS high_mm
    FROM regexp_matches(
      COALESCE(p_invoice_description, ''),
      '([0-9]{3,4})[[:space:]]*(mm)?[[:space:]]*[x×][[:space:]]*([0-9]{3,4})[[:space:]]*(mm)?',
      'gi'
    ) AS match
    WHERE match[2] IS NOT NULL OR match[4] IS NOT NULL
  ) AS pairs;

  IF v_pair_count = 1 AND p_width_mm IS NOT NULL AND p_height_mm IS NOT NULL THEN
    SELECT low_mm, high_mm
    INTO v_left, v_right
    FROM (
      SELECT DISTINCT
        least(round(match[1]::numeric), round(match[3]::numeric)) AS low_mm,
        greatest(round(match[1]::numeric), round(match[3]::numeric)) AS high_mm
      FROM regexp_matches(
        COALESCE(p_invoice_description, ''),
        '([0-9]{3,4})[[:space:]]*(mm)?[[:space:]]*[x×][[:space:]]*([0-9]{3,4})[[:space:]]*(mm)?',
        'gi'
      ) AS match
      WHERE match[2] IS NOT NULL OR match[4] IS NOT NULL
    ) AS pairs;

    v_product_left := least(round(p_width_mm), round(p_height_mm));
    v_product_right := greatest(round(p_width_mm), round(p_height_mm));

    IF v_left <> v_product_left OR v_right <> v_product_right THEN
      RETURN true;
    END IF;
  END IF;

  SELECT count(*)
  INTO v_roll_count
  FROM (
    SELECT DISTINCT round(width_mm) AS width_mm, round(length_mm) AS length_mm
    FROM (
      SELECT match[1]::numeric AS width_mm, match[3]::numeric * 1000 AS length_mm
      FROM regexp_matches(
        COALESCE(p_invoice_description, ''),
        '([0-9]+(\.[0-9]+)?)[[:space:]]*mm[[:space:]]*[x×][[:space:]]*([0-9]+(\.[0-9]+)?)[[:space:]]*m\M',
        'gi'
      ) AS match
      UNION ALL
      SELECT match[3]::numeric AS width_mm, match[1]::numeric * 1000 AS length_mm
      FROM regexp_matches(
        COALESCE(p_invoice_description, ''),
        '([0-9]+(\.[0-9]+)?)[[:space:]]*m[[:space:]]*[x×][[:space:]]*([0-9]+(\.[0-9]+)?)[[:space:]]*mm\M',
        'gi'
      ) AS match
    ) AS rolls
  ) AS unique_rolls;

  IF v_roll_count = 1 THEN
    SELECT width_mm, length_mm
    INTO v_roll_width, v_roll_length
    FROM (
      SELECT DISTINCT round(width_mm) AS width_mm, round(length_mm) AS length_mm
      FROM (
        SELECT match[1]::numeric AS width_mm, match[3]::numeric * 1000 AS length_mm
        FROM regexp_matches(
          COALESCE(p_invoice_description, ''),
          '([0-9]+(\.[0-9]+)?)[[:space:]]*mm[[:space:]]*[x×][[:space:]]*([0-9]+(\.[0-9]+)?)[[:space:]]*m\M',
          'gi'
        ) AS match
        UNION ALL
        SELECT match[3]::numeric AS width_mm, match[1]::numeric * 1000 AS length_mm
        FROM regexp_matches(
          COALESCE(p_invoice_description, ''),
          '([0-9]+(\.[0-9]+)?)[[:space:]]*m[[:space:]]*[x×][[:space:]]*([0-9]+(\.[0-9]+)?)[[:space:]]*mm\M',
          'gi'
        ) AS match
      ) AS rolls
    ) AS unique_rolls;

    IF p_width_mm IS NOT NULL AND round(v_roll_width) <> round(p_width_mm) THEN
      RETURN true;
    END IF;

    IF p_length_mm IS NOT NULL AND abs(v_roll_length - p_length_mm) > 1 THEN
      RETURN true;
    END IF;
  END IF;

  v_invoice_permanent := v_invoice ~ '\mpermanent\M';
  v_invoice_removable := v_invoice ~ '\mremovable\M';
  v_product_permanent := v_product ~ '\mpermanent\M';
  v_product_removable := v_product ~ '\mremovable\M';

  IF v_invoice_permanent <> v_invoice_removable
    AND v_product_permanent <> v_product_removable
    AND v_invoice_permanent <> v_product_permanent
  THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;


REVOKE ALL ON FUNCTION public.supplier_sku_details_conflict(text, text, numeric, numeric, numeric, numeric)
  FROM PUBLIC, anon;

COMMIT;
