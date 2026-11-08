-- HIPS duplicate consolidation + catalogue import definitions (forward only).
-- Target: Candid OS Test (axhkdwgmwhlbsstumndh). Do not apply on Live without review.

BEGIN;

-- Consolidate duplicate HIPS 2440×1220 catalogue rows (Test-first data repair).
-- Rollback: supabase/migrations/20261110120000_consolidate_hips_duplicate.rollback.sql

DO $$
DECLARE
  v_canon uuid := '7e7eed82-f203-4238-aeb2-c95dde58a287';
  v_dup   uuid := 'e3d871c5-bc9f-4e50-9515-3cc528146a18';
  v_7231  uuid := 'eb0977bd-db00-4097-8b63-73e9f0071bae';
  v_ps    uuid := '00accca3-4de7-42dd-8755-7c7f0579a90b';
  v_block int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.materials WHERE id = v_canon AND active) THEN
    RAISE EXCEPTION 'Canonical material missing or inactive';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.material_supplier_products
    WHERE id = v_ps AND material_id = v_canon AND active
  ) AND NOT EXISTS (SELECT 1 FROM public.materials WHERE id = v_dup AND active) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.materials WHERE id = v_dup AND active) THEN
    RAISE EXCEPTION 'Duplicate material missing or already inactive';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.material_supplier_products
    WHERE id = v_7231 AND material_id = v_canon AND is_preferred AND active
  ) THEN
    RAISE EXCEPTION '7231 product not preferred on canonical';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.material_supplier_products
    WHERE id = v_ps AND material_id = v_dup AND active
  ) THEN
    RAISE EXCEPTION 'PS1275 product not on duplicate material';
  END IF;

  SELECT count(*) INTO v_block
  FROM public.quote_item_material_components
  WHERE material_id = v_dup OR material_supplier_product_id = v_ps;
  IF v_block > 0 THEN
    RAISE EXCEPTION 'Quote components block consolidation (%).', v_block;
  END IF;

  SELECT count(*) INTO v_block FROM public.quote_item_costs WHERE material_id = v_dup;
  IF v_block > 0 THEN RAISE EXCEPTION 'Quote costs block consolidation (%).', v_block; END IF;

  SELECT count(*) INTO v_block
  FROM public.purchase_order_lines
  WHERE material_id = v_dup OR material_supplier_product_id = v_ps;
  IF v_block > 0 THEN RAISE EXCEPTION 'PO lines block consolidation (%).', v_block; END IF;

  SELECT count(*) INTO v_block
  FROM public.supplier_invoice_lines
  WHERE matched_supplier_product_id = v_ps;
  IF v_block > 0 THEN RAISE EXCEPTION 'Invoice lines block consolidation (%).', v_block; END IF;

  UPDATE public.material_supplier_products
  SET is_preferred = false, updated_at = now()
  WHERE id = v_ps;

  UPDATE public.material_supplier_products
  SET material_id = v_canon, updated_at = now()
  WHERE id = v_ps;

  UPDATE public.materials
  SET active = false, updated_at = now()
  WHERE id = v_dup;

  IF (
    SELECT count(*) FROM public.material_supplier_products
    WHERE material_id = v_canon AND active AND is_preferred
  ) <> 1 THEN
    RAISE EXCEPTION 'Canonical must have exactly one preferred product';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.material_supplier_products
    WHERE material_id = v_dup AND active
  ) THEN
    RAISE EXCEPTION 'Duplicate material still has active supplier products';
  END IF;
END $$;


CREATE OR REPLACE FUNCTION public.apply_initial_materials_import(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_effective date;
  v_catalog jsonb := $catalog$
[
  {
    "key": "foamalite-3mm-3050x1560",
    "name": "Foamalite 3mm PVC 3050mm x 1560mm",
    "category": "Board",
    "thicknessMm": 3,
    "colour": "White",
    "finish": null,
    "purchaseUnit": "sheet",
    "widthMm": 3050,
    "heightMm": 1560,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "foamalite-3mm-3050x1560--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "3mm 3050x1560mm White P/E Foamalite Xpress Foam PVC (PQ120)",
        "price": "25.47",
        "priceUnit": "sheet",
        "preferred": true
      },
      {
        "key": "foamalite-3mm-3050x1560--antalis",
        "supplierName": "Antalis",
        "description": "Foamalite, XPRESS, Filmed, white 3.000mm 1560mm x 3050mm, 7301046",
        "price": "23.35",
        "priceUnit": "sheet",
        "preferred": false
      }
    ]
  },
  {
    "key": "foamalite-3mm-2440x1220",
    "name": "Foamalite 3mm PVC 2440mm x 1220mm",
    "category": "Board",
    "thicknessMm": 3,
    "colour": "White",
    "finish": null,
    "purchaseUnit": "sheet",
    "widthMm": 2440,
    "heightMm": 1220,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "foamalite-3mm-2440x1220--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "3mm 1220x2440mm White P/E Foamalite Xpress Foam PVC (PQ200)",
        "price": "16.15",
        "priceUnit": "sheet",
        "preferred": true
      },
      {
        "key": "foamalite-3mm-2440x1220--antalis",
        "supplierName": "Antalis",
        "description": "Foamalite, XPRESS, Filmed, white 3.000mm 1220mm x 2440mm, 7301035",
        "price": "14.6",
        "priceUnit": "sheet",
        "preferred": false
      }
    ]
  },
  {
    "key": "correx-1524x3050-3-5mm",
    "name": "Correx 1524mm x 3050mm 3.5mm",
    "category": "Board",
    "thicknessMm": 3.5,
    "colour": "White",
    "finish": null,
    "purchaseUnit": "sheet",
    "widthMm": 1524,
    "heightMm": 3050,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "correx-1524x3050-3-5mm--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "3.5m/600g 1524 x 3050mm(LF) White Correx Fluted PP (Untrimmed)",
        "price": "12.227",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "correx-1220x2440-3-5mm",
    "name": "Correx 1220mm x 2440mm 3.5mm",
    "category": "Board",
    "thicknessMm": 3.5,
    "colour": "White",
    "finish": null,
    "purchaseUnit": "sheet",
    "widthMm": 1220,
    "heightMm": 2440,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "correx-1220x2440-3-5mm--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "3.5m/600g 1220x2440mm (LF) White Correx Fluted PP (Untrimmed)",
        "price": "7.592",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "correx-1524x3050-4mm",
    "name": "Correx 1524mm x 3050mm 4mm",
    "category": "Board",
    "thicknessMm": 4,
    "colour": "White",
    "finish": null,
    "purchaseUnit": "sheet",
    "widthMm": 1524,
    "heightMm": 3050,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "correx-1524x3050-4mm--antalis",
        "supplierName": "Antalis",
        "description": "Correx®, White, matt, Long Flute, White 4.000mm 1524mm x 3050mm",
        "price": "11.21",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "swedboard-16mm-1600x3050",
    "name": "Swedboard 16mm 1600mm x 3050mm",
    "category": "Board",
    "thicknessMm": 16,
    "colour": null,
    "finish": null,
    "purchaseUnit": "sheet",
    "widthMm": 1600,
    "heightMm": 3050,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "swedboard-16mm-1600x3050--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "16mm 1600 x 3050mm Swedboard Fibre Premium Structured Paper Board (PQ 65) FSC Mix Credit",
        "price": "57.309",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "bubble-wrap-1500",
    "name": "Bubble Wrap 1500mm",
    "category": "Consumable",
    "thicknessMm": null,
    "colour": null,
    "finish": null,
    "purchaseUnit": "roll",
    "widthMm": 1500,
    "heightMm": null,
    "lengthMm": 100000,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "bubble-wrap-1500--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "Bubble Wrap 1500mm x 100m Small",
        "price": "19.02",
        "priceUnit": "roll",
        "preferred": true
      }
    ]
  },
  {
    "key": "perfectear-medium-1220",
    "name": "PerfecTear Medium Application Tape 1220mm",
    "category": "Consumable",
    "thicknessMm": null,
    "colour": null,
    "finish": null,
    "purchaseUnit": "roll",
    "widthMm": 1220,
    "heightMm": null,
    "lengthMm": 91400,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "perfectear-medium-1220--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "1220mm x 91.4m PerfecTear Medium Application Tape (GXP 550P)",
        "price": "104.66",
        "priceUnit": "roll",
        "preferred": true
      }
    ]
  },
  {
    "key": "kraft-brown-600-90gsm",
    "name": "Kraft Brown Wrapping Paper 600mm 90gsm",
    "category": "Consumable",
    "thicknessMm": null,
    "colour": null,
    "finish": null,
    "purchaseUnit": "roll",
    "widthMm": 600,
    "heightMm": null,
    "lengthMm": 220000,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "kraft-brown-600-90gsm--antalis",
        "supplierName": "Antalis",
        "description": "Ribbed Kraft Paper, Master'in Access 90 g/m2, 600 mm x 220.00 m",
        "price": "25.23",
        "priceUnit": "roll",
        "preferred": true
      }
    ]
  },
  {
    "key": "xanita-10mm-2440x1220",
    "name": "Xanita 10mm White 2440mm x 1220mm",
    "category": "Board",
    "thicknessMm": 10,
    "colour": "White",
    "finish": "Matt",
    "purchaseUnit": "sheet",
    "widthMm": 2440,
    "heightMm": 1220,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "xanita-10mm-2440x1220--antalis",
        "supplierName": "Antalis",
        "description": "Xanita, Print, White, matt, 10.000mm 2440mm x 1220mm",
        "price": "26.94",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "foamalite-5mm-2440x1220",
    "name": "Foamalite 5mm PVC 2440mm x 1220mm",
    "category": "Board",
    "thicknessMm": 5,
    "colour": "White",
    "finish": null,
    "purchaseUnit": "sheet",
    "widthMm": 2440,
    "heightMm": 1220,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "foamalite-5mm-2440x1220--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "5mm 1220x2440mm White P/E Foamalite Xpress Foam PVC (PQ120)",
        "price": "25.99",
        "priceUnit": "sheet",
        "preferred": true
      },
      {
        "key": "foamalite-5mm-2440x1220--antalis",
        "supplierName": "Antalis",
        "description": "Foamalite, XPRESS, Filmed, white 5.000mm 1220mm x 2440mm",
        "price": "23.77",
        "priceUnit": "sheet",
        "preferred": false
      }
    ]
  },
  {
    "key": "dibond-sigwhite-3mm-1220x2440",
    "name": "Dibond SigWhite Matt 3mm 1220mm x 2440mm",
    "category": "Board",
    "thicknessMm": 3,
    "colour": "White",
    "finish": "Matt",
    "purchaseUnit": "sheet",
    "widthMm": 1220,
    "heightMm": 2440,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "dibond-sigwhite-3mm-1220x2440--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "3mm 1220x2440mm SigWhite Matt/Primer (0.15) Easy Release (Digital) PQ 90 (FG-04399)",
        "price": "26.69",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "dibond-eco-3mm-1500x3050",
    "name": "Dibond SigWhite Eco 3mm 1500mm x 3050mm",
    "category": "Board",
    "thicknessMm": 3,
    "colour": "White",
    "finish": "Matt",
    "purchaseUnit": "sheet",
    "widthMm": 1500,
    "heightMm": 3050,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "dibond-eco-3mm-1500x3050--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "3mm 1500x3050mm SigWhite Eco DigMatt/Primer (0.15) Easy Release (Digital) PQ 60 (FG-04401)",
        "price": "41.15",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "alupanel-mirror-3mm-1220x3050",
    "name": "Alupanel Mirror Silver 3mm 1220mm x 3050mm",
    "category": "Board",
    "thicknessMm": 3,
    "colour": "Silver",
    "finish": "Mirror",
    "purchaseUnit": "sheet",
    "widthMm": 1220,
    "heightMm": 3050,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "alupanel-mirror-3mm-1220x3050--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "3mm 1220x3050mm Mirror Silver/Primer (FG-00169) Silver Mirror/Prime 0.3 skin PQ 70",
        "price": "113.54",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "alupanel-brushed-3mm-2440x1220",
    "name": "Alupanel Brushed Gold/Bronze 3mm 2440mm x 1220mm",
    "category": "Board",
    "thicknessMm": 3,
    "colour": "Gold/Bronze",
    "finish": "Brushed",
    "purchaseUnit": "sheet",
    "widthMm": 2440,
    "heightMm": 1220,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "alupanel-brushed-3mm-2440x1220--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "3mm 2440x1220mm Brushed Gold 0.3skin (FG-00149) Alupanel Brushed Bronze/Brushed Gold PQ 90",
        "price": "93.465",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "coala-white-3mm-3050x1500",
    "name": "Coala Printbond White 3mm 3050mm x 1500mm",
    "category": "Board",
    "thicknessMm": 3,
    "colour": "White",
    "finish": "Matt",
    "purchaseUnit": "sheet",
    "widthMm": 3050,
    "heightMm": 1500,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "coala-white-3mm-3050x1500--antalis",
        "supplierName": "Antalis",
        "description": "Coala, Printbond 208 Lite LX/LX, Latex matt/matt, metal, white, 3.000mm 3050mm x 1500mm",
        "price": "55.25",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "coala-white-3mm-2440x1220",
    "name": "Coala Printbond White 3mm 2440mm x 1220mm",
    "category": "Board",
    "thicknessMm": 3,
    "colour": "White",
    "finish": "Matt",
    "purchaseUnit": "sheet",
    "widthMm": 2440,
    "heightMm": 1220,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "coala-white-3mm-2440x1220--antalis",
        "supplierName": "Antalis",
        "description": "Coala, Printbond 208 Lite LX/LX, Latex matt/matt, metal, white, 3.000mm 2440mm x 1220mm",
        "price": "35.94",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "coala-silver-3mm-1220x2440",
    "name": "Coala Printbond Brushed Silver 3mm 1220mm x 2440mm",
    "category": "Board",
    "thicknessMm": 3,
    "colour": "Silver",
    "finish": "Brushed",
    "purchaseUnit": "sheet",
    "widthMm": 1220,
    "heightMm": 2440,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "coala-silver-3mm-1220x2440--antalis",
        "supplierName": "Antalis",
        "description": "Coala, Printbond 208 Lite, brushed silver, 3.000mm 1220mm x 2440mm",
        "price": "45.44",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "swedboard-16mm-1600x3200",
    "name": "Swedboard 16mm 1600mm x 3200mm Premium",
    "category": "Board",
    "thicknessMm": 16,
    "colour": null,
    "finish": null,
    "purchaseUnit": "sheet",
    "widthMm": 1600,
    "heightMm": 3200,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "swedboard-16mm-1600x3200--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "16mm 1600 x 3200mm Swedboard Fibre Premium Structured Paper Board (PQ 65) FSC Mix Credit",
        "price": "58.968",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "swedboard-16mm-1600x3200-fr",
    "name": "Swedboard 16mm 1600mm x 3200mm FR",
    "category": "Board",
    "thicknessMm": 16,
    "colour": null,
    "finish": "FR",
    "purchaseUnit": "sheet",
    "widthMm": 1600,
    "heightMm": 3200,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "swedboard-16mm-1600x3200-fr--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "16mm 1600 x 3200mm Swedboard Fibre FR Structured FR Board (PQ 65) FSC Mix Credit",
        "price": "88.07",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "hips-1mm-2440x1220",
    "name": "HIPS 1mm White 2440mm x 1220mm",
    "category": "Board",
    "thicknessMm": 1,
    "colour": "White",
    "finish": "Gloss/matt",
    "purchaseUnit": "sheet",
    "widthMm": 2440,
    "heightMm": 1220,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "hips-1mm-2440x1220--ppb",
        "supplierName": "PPB",
        "description": "WHITE 7231 GLOSS/MATT HIPS WITH FILM (ON GLOSS SIDE) 1MM BULK PACK 2440mm x 1220mm",
        "price": "26",
        "priceUnit": "sheet",
        "preferred": true
      },
      {
        "key": "hips-1mm-2440x1220--ppb-ps1275-p91",
        "supplierName": "PPB",
        "description": "WHITE PS1275 P91 GLOSS/MATT HIPS WITH FILM (ON GLOSS SIDE) 1MM BULK PACK 2440mm x 1220mm",
        "price": "26",
        "priceUnit": "sheet",
        "preferred": false
      }
    ]
  },
  {
    "key": "briteline-greyback-1370x50",
    "name": "Briteline Greyback Removable 1370mm x 50m",
    "category": "Vinyl",
    "thicknessMm": null,
    "colour": "White",
    "finish": "Matt",
    "purchaseUnit": "roll",
    "widthMm": 1370,
    "heightMm": null,
    "lengthMm": 50000,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "briteline-greyback-1370x50--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "Briteline MT WHT GB Removable 1370mm x 50m Monomeric Vinyl - Grey Adhesive (BLMVMWRG1370)",
        "price": "89.11",
        "priceUnit": "roll",
        "preferred": true
      }
    ]
  },
  {
    "key": "su3-70-1350x50",
    "name": "SU3-70 Semi-matt UV Laminate 1350mm x 50m",
    "category": "Laminate",
    "thicknessMm": null,
    "colour": null,
    "finish": "Semi-matt",
    "purchaseUnit": "roll",
    "widthMm": 1350,
    "heightMm": null,
    "lengthMm": 50000,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "su3-70-1350x50--all-print-supplies",
        "supplierName": "All Print Supplies",
        "description": "SU3-70 SEMI-MATT UV SEAL 50M X 1350MM",
        "price": "127.21",
        "priceUnit": "roll",
        "preferred": true
      }
    ]
  },
  {
    "key": "simply-rollup-1067x50",
    "name": "Simply Roll Up 300 Greyback 1067mm x 50m",
    "category": "Vinyl",
    "thicknessMm": null,
    "colour": null,
    "finish": null,
    "purchaseUnit": "roll",
    "widthMm": 1067,
    "heightMm": null,
    "lengthMm": 50000,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "simply-rollup-1067x50--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "Simply Roll Up 300 GB 1067mm x 50m Grey Back Textured PVC Film",
        "price": "178.2",
        "priceUnit": "roll",
        "preferred": true
      }
    ]
  },
  {
    "key": "simply-drywipe-1300x100",
    "name": "Simply Gloss Dry-wipe Laminate 1300mm x 100m",
    "category": "Laminate",
    "thicknessMm": null,
    "colour": null,
    "finish": "Gloss",
    "purchaseUnit": "roll",
    "widthMm": 1300,
    "heightMm": null,
    "lengthMm": 100000,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "simply-drywipe-1300x100--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "Simply Gloss Dry Wipe Lam UV 1300mm x 100m Gloss OPP Laminate 50 micron FF",
        "price": "238.91",
        "priceUnit": "roll",
        "preferred": true
      }
    ]
  },
  {
    "key": "supreme-banner-1600x30",
    "name": "Supreme Banner FR 450g 1600mm x 30m",
    "category": "Banner",
    "thicknessMm": null,
    "colour": null,
    "finish": null,
    "purchaseUnit": "roll",
    "widthMm": 1600,
    "heightMm": null,
    "lengthMm": 30000,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "supreme-banner-1600x30--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "Supreme Banner FR 450g 1600mm x 30mtr (PRO) Frontlit1000x1000 18 x 18 [Hard tube Packed]",
        "price": "135.91",
        "priceUnit": "roll",
        "preferred": true
      }
    ]
  },
  {
    "key": "hp-730-photo-black-300",
    "name": "HP 730 Photo Black 300ml",
    "category": "Ink",
    "thicknessMm": null,
    "colour": "Photo black",
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": 0.3,
    "costingUnit": "litre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "hp-730-photo-black-300--papergraphics",
        "supplierName": "Papergraphics",
        "description": "HP 730 Ink Cartridge Photo Black - 300ml",
        "price": "130",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "hp-730-matte-black-300",
    "name": "HP 730 Matte Black 300ml",
    "category": "Ink",
    "thicknessMm": null,
    "colour": "Matte black",
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": 0.3,
    "costingUnit": "litre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "hp-730-matte-black-300--papergraphics",
        "supplierName": "Papergraphics",
        "description": "HP 730 Ink Cartridge Matte Black - 300ml",
        "price": "130",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "hp-730-grey-300",
    "name": "HP 730 Grey 300ml",
    "category": "Ink",
    "thicknessMm": null,
    "colour": "Grey",
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": 0.3,
    "costingUnit": "litre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "hp-730-grey-300--papergraphics",
        "supplierName": "Papergraphics",
        "description": "HP 730 Ink Cartridge Grey - 300ml",
        "price": "130",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "hp-832-cyan-1000",
    "name": "HP 832 Cyan 1000ml",
    "category": "Ink",
    "thicknessMm": null,
    "colour": "Cyan",
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": 1,
    "costingUnit": "litre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "hp-832-cyan-1000--papergraphics",
        "supplierName": "Papergraphics",
        "description": "HP/4UV76A No. 832 Latex Cyan Ink Cartridge 1000ml",
        "price": "95",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "hp-832-magenta-1000",
    "name": "HP 832 Magenta 1000ml",
    "category": "Ink",
    "thicknessMm": null,
    "colour": "Magenta",
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": 1,
    "costingUnit": "litre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "hp-832-magenta-1000--papergraphics",
        "supplierName": "Papergraphics",
        "description": "HP/4UV77A No. 832 Latex Magenta Ink 1000ml",
        "price": "95",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "hp-832-black-1000",
    "name": "HP 832 Black 1000ml",
    "category": "Ink",
    "thicknessMm": null,
    "colour": "Black",
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": 1,
    "costingUnit": "litre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "hp-832-black-1000--papergraphics",
        "supplierName": "Papergraphics",
        "description": "HP/4UV75A No. 832 Latex Black Ink 1000ml",
        "price": "95",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "hp-832-yellow-1000",
    "name": "HP 832 Yellow 1000ml",
    "category": "Ink",
    "thicknessMm": null,
    "colour": "Yellow",
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": 1,
    "costingUnit": "litre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "hp-832-yellow-1000--papergraphics",
        "supplierName": "Papergraphics",
        "description": "HP/4UV78A No. 832 Latex Yellow Ink 1000ml",
        "price": "95",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "hp-832-optimiser-1000",
    "name": "HP 832 Optimiser 1000ml",
    "category": "Ink",
    "thicknessMm": null,
    "colour": "Optimiser",
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": 1,
    "costingUnit": "litre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "hp-832-optimiser-1000--papergraphics",
        "supplierName": "Papergraphics",
        "description": "HP/4UV81A No. 832 Latex Optimiser Ink 1000ml",
        "price": "95",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "hp-882-magenta-5000",
    "name": "HP 882 Magenta 5000ml",
    "category": "Ink",
    "thicknessMm": null,
    "colour": "Magenta",
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": 5,
    "costingUnit": "litre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "hp-882-magenta-5000--perfect-colours",
        "supplierName": "Perfect Colours",
        "description": "HP No. 882 Latex Ink Cartridge Magenta - 5000ml",
        "price": "331.34",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "hp-882-yellow-5000",
    "name": "HP 882 Yellow 5000ml",
    "category": "Ink",
    "thicknessMm": null,
    "colour": "Yellow",
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": 5,
    "costingUnit": "litre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "hp-882-yellow-5000--perfect-colours",
        "supplierName": "Perfect Colours",
        "description": "HP No. 882 Latex Ink Cartridge Yellow - 5000ml",
        "price": "335.74",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "hp-882-optimizer-5000",
    "name": "HP 882 Optimizer 5000ml",
    "category": "Ink",
    "thicknessMm": null,
    "colour": null,
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": 5,
    "costingUnit": "litre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "hp-882-optimizer-5000--perfect-colours",
        "supplierName": "Perfect Colours",
        "description": "HP No. 882 Latex Optimizer Ink Cartridge - 5000ml",
        "price": "335.74",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "hp-882-overcoat-5000",
    "name": "HP 882 Overcoat 5000ml",
    "category": "Ink",
    "thicknessMm": null,
    "colour": null,
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": 5,
    "costingUnit": "litre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "hp-882-overcoat-5000--perfect-colours",
        "supplierName": "Perfect Colours",
        "description": "HP No. 882 Latex Overcoat Ink Cartridge - 5000ml",
        "price": "331.34",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "hp-886-white-3000",
    "name": "HP 886 White 3000ml",
    "category": "Ink",
    "thicknessMm": null,
    "colour": "White",
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": 3,
    "costingUnit": "litre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "hp-886-white-3000--perfect-colours",
        "supplierName": "Perfect Colours",
        "description": "HP No. 886 Latex Ink Cartridge White - 3000ml",
        "price": "253.25",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "hp-latex-printhead-cleaning-kit",
    "name": "HP Latex Printhead Cleaning Kit",
    "category": "Consumable",
    "thicknessMm": null,
    "colour": null,
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "each",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "hp-latex-printhead-cleaning-kit--perfect-colours",
        "supplierName": "Perfect Colours",
        "description": "HP Latex Printhead Cleaning Kit",
        "price": "237.89",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "showcard-strut-240",
    "name": "Showcard Strut Taped White 240mm",
    "category": "Consumable",
    "thicknessMm": null,
    "colour": "White",
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "each",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "showcard-strut-240--antalis",
        "supplierName": "Antalis",
        "description": "Showcard, Struts, Taped, White, 240mm",
        "price": "0.38",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "showcard-strut-190",
    "name": "Showcard Strut Taped White 190mm",
    "category": "Consumable",
    "thicknessMm": null,
    "colour": "White",
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "each",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "showcard-strut-190--antalis",
        "supplierName": "Antalis",
        "description": "Showcard, Struts, Taped, White, 190mm",
        "price": "0.36",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "showcard-strut-140",
    "name": "Showcard Strut Taped White 140mm",
    "category": "Consumable",
    "thicknessMm": null,
    "colour": "White",
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "each",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "showcard-strut-140--antalis",
        "supplierName": "Antalis",
        "description": "Showcard, Struts, Taped, White, 140mm",
        "price": "0.34",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "tangential-knife-36-pack",
    "name": "Standard Tangential Knife 36°",
    "category": "Consumable",
    "thicknessMm": null,
    "colour": null,
    "finish": null,
    "purchaseUnit": "pack",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "each",
    "costingPackQuantity": 5,
    "products": [
      {
        "key": "tangential-knife-36-pack--perfect-colours",
        "supplierName": "Perfect Colours",
        "description": "STANDARD TANGENTIAL KNIFE 36' (Pack of 5)",
        "price": "173.4",
        "priceUnit": "pack",
        "preferred": true
      }
    ]
  },
  {
    "key": "heavy-duty-cutout-knife",
    "name": "Heavy Duty Cutout Knife",
    "category": "Consumable",
    "thicknessMm": null,
    "colour": null,
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "each",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "heavy-duty-cutout-knife--perfect-colours",
        "supplierName": "Perfect Colours",
        "description": "HEAVY DUTY CUTOUT KNIFE",
        "price": "80",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "orabond-1395-12x50",
    "name": "Orabond 1395 Tape 12mm x 50m",
    "category": "Consumable",
    "thicknessMm": null,
    "colour": null,
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": 12,
    "heightMm": null,
    "lengthMm": 50000,
    "inkVolumeLitres": null,
    "costingUnit": "each",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "orabond-1395-12x50--antalis",
        "supplierName": "Antalis",
        "description": "Orabond, 1395, transparent, 130µm acrylic solvent 12mm x 50.00m, pack of 20 rolls",
        "price": "3.31",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  }
]
$catalog$::jsonb;
  v_aliases jsonb := $aliases$
[
  {
    "canonicalName": "Pyramid Display Materials",
    "alias": "Pyramid Display"
  },
  {
    "canonicalName": "Pyramid Display Materials",
    "alias": "Pyramid Display Materials Ltd."
  },
  {
    "canonicalName": "Pyramid Display Materials",
    "alias": "Pyramid Display Materials Ltd"
  },
  {
    "canonicalName": "Antalis",
    "alias": "Antalis Ltd"
  },
  {
    "canonicalName": "Antalis",
    "alias": "Antalis Ltd."
  },
  {
    "canonicalName": "Perfect Colours",
    "alias": "Perfect Colours Ltd"
  },
  {
    "canonicalName": "Perfect Colours",
    "alias": "Perfect Colours Ltd."
  },
  {
    "canonicalName": "Papergraphics",
    "alias": "Papergraphics Limited"
  },
  {
    "canonicalName": "Papergraphics",
    "alias": "Papergraphics Ltd"
  },
  {
    "canonicalName": "Papergraphics",
    "alias": "Papergraphics Ltd."
  },
  {
    "canonicalName": "PPB",
    "alias": "PPB Ltd"
  },
  {
    "canonicalName": "PPB",
    "alias": "PPB Ltd."
  },
  {
    "canonicalName": "All Print Supplies",
    "alias": "All Print Supplies Ltd"
  },
  {
    "canonicalName": "All Print Supplies",
    "alias": "All Print Supplies Ltd."
  }
]
  $aliases$::jsonb;
  v_medium_catalog jsonb := $medium_catalog$
[
  {
    "key": "bubble-wrap-1500",
    "name": "Bubble Wrap 1500mm",
    "category": "Consumable",
    "thicknessMm": null,
    "colour": null,
    "finish": null,
    "purchaseUnit": "roll",
    "widthMm": 1500,
    "heightMm": null,
    "lengthMm": 100000,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "bubble-wrap-1500--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "Bubble Wrap 1500mm x 100m Small",
        "price": "19.02",
        "priceUnit": "roll",
        "preferred": true
      },
      {
        "key": "bubble-wrap-1500--antalis",
        "supplierName": "Antalis",
        "description": "Air Bubble Film, Jiffy Small Bubble Wrap 1500 mm x 100.00 m, 1 ply, Clear, 1 reel",
        "price": "33.29",
        "priceUnit": "roll",
        "preferred": false
      }
    ]
  },
  {
    "key": "perfectear-medium-1220",
    "name": "PerfecTear Medium Application Tape 1220mm",
    "category": "Consumable",
    "thicknessMm": null,
    "colour": null,
    "finish": null,
    "purchaseUnit": "roll",
    "widthMm": 1220,
    "heightMm": null,
    "lengthMm": 91400,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "perfectear-medium-1220--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "1220mm x 91.4m PerfecTear Medium Application Tape (GXP 550P)",
        "price": "104.66",
        "priceUnit": "roll",
        "preferred": true
      },
      {
        "key": "perfectear-medium-1220--all-print-supplies",
        "supplierName": "All Print Supplies",
        "description": "KLEENTEAR 50 MEDIUM 100YDS X 1220MM",
        "price": "104.78",
        "priceUnit": "roll",
        "preferred": false
      }
    ]
  },
  {
    "key": "edixion-offset-350-sra3",
    "name": "Edixion Offset 350gsm SRA3 450mm x 320mm",
    "category": "Paper",
    "thicknessMm": null,
    "colour": "White",
    "finish": "Short grain",
    "purchaseUnit": "sheet",
    "widthMm": 450,
    "heightMm": 320,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "sheet",
    "costingPackQuantity": 125,
    "products": [
      {
        "key": "edixion-offset-350-sra3--antalis",
        "supplierName": "Antalis",
        "description": "Edixion, Offset, white, 350g/m2 450mm x 320mm, SRA3, short grain pack of 125 sheets, FSC Mix Credit",
        "price": "0.08254",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "edixion-offset-300-sra3",
    "name": "Edixion Offset 300gsm SRA3 450mm x 320mm",
    "category": "Paper",
    "thicknessMm": null,
    "colour": "White",
    "finish": "Short grain",
    "purchaseUnit": "sheet",
    "widthMm": 450,
    "heightMm": 320,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "sheet",
    "costingPackQuantity": 125,
    "products": [
      {
        "key": "edixion-offset-300-sra3--antalis",
        "supplierName": "Antalis",
        "description": "Edixion, Offset, white, 300g/m2 450mm x 320mm, SRA3, short grain pack of 125 sheets, FSC Mix Credit",
        "price": "0.06983",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "edixion-offset-250-sra3",
    "name": "Edixion Offset 250gsm SRA3 450mm x 320mm",
    "category": "Paper",
    "thicknessMm": null,
    "colour": "White",
    "finish": "Short grain",
    "purchaseUnit": "sheet",
    "widthMm": 450,
    "heightMm": 320,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "sheet",
    "costingPackQuantity": 125,
    "products": [
      {
        "key": "edixion-offset-250-sra3--antalis",
        "supplierName": "Antalis",
        "description": "Edixion, Offset, white, woodfree ECF 250g/m2 450mm x 320mm, SRA3, short grain pack of 125 sheets, FSC Mix Credit",
        "price": "0.05817",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "edixion-offset-170-sra3",
    "name": "Edixion Offset 170gsm SRA3 450mm x 320mm",
    "category": "Paper",
    "thicknessMm": null,
    "colour": "White",
    "finish": "Short grain",
    "purchaseUnit": "sheet",
    "widthMm": 450,
    "heightMm": 320,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "sheet",
    "costingPackQuantity": 250,
    "products": [
      {
        "key": "edixion-offset-170-sra3--antalis",
        "supplierName": "Antalis",
        "description": "Edixion, Offset, white, 170g/m2, 450mm x 320mm, SRA3, short grain, pack of 250 sheets, FSC Mix Credit",
        "price": "0.03826",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "novatec-silk-350-sra3",
    "name": "Novatec Silk 350gsm SRA3 450mm x 320mm",
    "category": "Paper",
    "thicknessMm": null,
    "colour": "White",
    "finish": "Silk",
    "purchaseUnit": "sheet",
    "widthMm": 450,
    "heightMm": 320,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "sheet",
    "costingPackQuantity": 125,
    "products": [
      {
        "key": "novatec-silk-350-sra3--antalis",
        "supplierName": "Antalis",
        "description": "Novatech, Digital silk, Silk 2-side coated, white, woodfree ECF 350g/m2 450mm x 320mm, SRA3, short grain pack of 125 sheets, FSC Mix Credit",
        "price": "0.08919",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "novatec-silk-300-sra3",
    "name": "Novatec Silk 300gsm SRA3 450mm x 320mm",
    "category": "Paper",
    "thicknessMm": null,
    "colour": "White",
    "finish": "Silk",
    "purchaseUnit": "sheet",
    "widthMm": 450,
    "heightMm": 320,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "sheet",
    "costingPackQuantity": 125,
    "products": [
      {
        "key": "novatec-silk-300-sra3--antalis",
        "supplierName": "Antalis",
        "description": "Novatech, Digital silk, Silk 2-side coated, white, woodfree ECF 300g/m2 450mm x 320mm, SRA3, short grain pack of 125 sheets, FSC Mix Credit",
        "price": "0.07548",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "novatec-silk-250-sra3",
    "name": "Novatec Silk 250gsm SRA3 450mm x 320mm",
    "category": "Paper",
    "thicknessMm": null,
    "colour": "White",
    "finish": "Silk",
    "purchaseUnit": "sheet",
    "widthMm": 450,
    "heightMm": 320,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "sheet",
    "costingPackQuantity": 125,
    "products": [
      {
        "key": "novatec-silk-250-sra3--antalis",
        "supplierName": "Antalis",
        "description": "Novatech, Digital silk, Silk 2-side coated, white, woodfree ECF 250g/m2 450mm x 320mm, SRA3, short grain pack of 125 sheets, FSC Mix Credit",
        "price": "0.06212",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "novatec-silk-170-sra3",
    "name": "Novatec Silk 170gsm SRA3 320mm x 450mm",
    "category": "Paper",
    "thicknessMm": null,
    "colour": "White",
    "finish": "Silk",
    "purchaseUnit": "sheet",
    "widthMm": 320,
    "heightMm": 450,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "sheet",
    "costingPackQuantity": 250,
    "products": [
      {
        "key": "novatec-silk-170-sra3--antalis",
        "supplierName": "Antalis",
        "description": "Novatech, Digital silk, Silk 2-side coated, white, woodfree ECF 170g/m2 320mm x 450mm, SRA3, long grain pack of 250 sheets, FSC Mix Credit",
        "price": "0.04132",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "emblem-greyboard-300-450x640",
    "name": "Emblem Greyboard 300gsm 450mm x 640mm",
    "category": "Paper",
    "thicknessMm": 0.48,
    "colour": "Grey",
    "finish": "Long grain",
    "purchaseUnit": "sheet",
    "widthMm": 450,
    "heightMm": 640,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "sheet",
    "costingPackQuantity": 265,
    "products": [
      {
        "key": "emblem-greyboard-300-450x640--antalis",
        "supplierName": "Antalis",
        "description": "EMBLEM, Greyboard, Grey, 100% recycled 300g/m2, 480µm 450mm x 640mm, long grain Bundle of 265 Sheets, FSC Recycled 100% Pallet of 18 Bundles",
        "price": "0.12854",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "stationery-box-a4-brown",
    "name": "Stationery Box A4 Brown",
    "category": "Packaging",
    "thicknessMm": null,
    "colour": "Brown",
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "each",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "stationery-box-a4-brown--antalis",
        "supplierName": "Antalis",
        "description": "Stationery box, With Lid A4, brown 305mm x 216mm x 57mm, Pack of 50",
        "price": "0.30769",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "stationery-box-a4-white",
    "name": "Stationery Box A4 White",
    "category": "Packaging",
    "thicknessMm": null,
    "colour": "White",
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "each",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "stationery-box-a4-white--antalis",
        "supplierName": "Antalis",
        "description": "Stationery box, With Lid A4, white 305mm x 216mm x 57mm, Pack of 50 1 Ream",
        "price": "0.3384",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "stationery-box-a5-brown",
    "name": "Stationery Box A5 Brown",
    "category": "Packaging",
    "thicknessMm": null,
    "colour": "Brown",
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "each",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "stationery-box-a5-brown--antalis",
        "supplierName": "Antalis",
        "description": "Stationery Box Brown A5 ream boxes and lids Inner dim. 215 x 156 x 57mm 600 micron solidboard pack of 100",
        "price": "0.84",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "c4-manilla-envelope",
    "name": "C4 Manilla Board Back Envelope",
    "category": "Packaging",
    "thicknessMm": null,
    "colour": "Manilla",
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "each",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "c4-manilla-envelope--antalis",
        "supplierName": "Antalis",
        "description": "River series, Pocket, C4, 229 x 324 mm Manilla, Board back envelope, Superseal with adhesive flap, 120g/m2 box of 125 pieces",
        "price": "0.149",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "e-flute-short-1067x1575",
    "name": "E-flute White 1067mm x 1575mm Short Flute",
    "category": "Board",
    "thicknessMm": null,
    "colour": "White",
    "finish": "Short flute",
    "purchaseUnit": "sheet",
    "widthMm": 1067,
    "heightMm": 1575,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "e-flute-short-1067x1575--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "E Flute 190Y/180W 1067x1575mm (Short Flute) Corrugated Board (PQ 700) 'FSC Mix Credit",
        "price": "2.741",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "e-flute-long-1575x1065",
    "name": "E-flute White 1575mm x 1065mm Long Flute",
    "category": "Board",
    "thicknessMm": 1.7,
    "colour": "White",
    "finish": "Long flute",
    "purchaseUnit": "sheet",
    "widthMm": 1575,
    "heightMm": 1065,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "e-flute-long-1575x1065--antalis",
        "supplierName": "Antalis",
        "description": "Corrugated Board, E - Flute, white 190Y/180W, Long Flute, 504g/m2, 1700µm 1575mm x 1065mm, FSC Mix Credit",
        "price": "3.65",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  },
  {
    "key": "nucoat-m16-permanent-1370x50",
    "name": "Nucoat M16 Permanent White 1370mm x 50m",
    "category": "Vinyl",
    "thicknessMm": null,
    "colour": "White",
    "finish": "Matt permanent",
    "purchaseUnit": "roll",
    "widthMm": 1370,
    "heightMm": null,
    "lengthMm": 50000,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "nucoat-m16-permanent-1370x50--all-print-supplies",
        "supplierName": "All Print Supplies",
        "description": "M16-P-P MT WH HOP PERM PE 50 X 1370",
        "price": "129.85",
        "priceUnit": "roll",
        "preferred": true
      }
    ]
  },
  {
    "key": "nucoat-m16-high-tack-1370x50",
    "name": "Nucoat M16 High Tack White 1370mm x 50m",
    "category": "Vinyl",
    "thicknessMm": null,
    "colour": "White",
    "finish": "Matt high tack",
    "purchaseUnit": "roll",
    "widthMm": 1370,
    "heightMm": null,
    "lengthMm": 50000,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "nucoat-m16-high-tack-1370x50--all-print-supplies",
        "supplierName": "All Print Supplies",
        "description": "M16-H-P MT WH HIGH PE 50 X 1370",
        "price": "266.18",
        "priceUnit": "roll",
        "preferred": true
      }
    ]
  },
  {
    "key": "gu3-70-gloss-1350x50",
    "name": "GU3-70 Gloss UV Laminate 1350mm x 50m",
    "category": "Laminate",
    "thicknessMm": null,
    "colour": null,
    "finish": "Gloss",
    "purchaseUnit": "roll",
    "widthMm": 1350,
    "heightMm": null,
    "lengthMm": 50000,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "gu3-70-gloss-1350x50--all-print-supplies",
        "supplierName": "All Print Supplies",
        "description": "GU3-70 ULTRA GLOSS UV SEAL 50M X 1350MM",
        "price": "139.68",
        "priceUnit": "roll",
        "preferred": true
      }
    ]
  },
  {
    "key": "m73-floor-1370x50",
    "name": "M73 Matt R10 Floor Vinyl 1370mm x 50m",
    "category": "Vinyl",
    "thicknessMm": null,
    "colour": null,
    "finish": "Matt",
    "purchaseUnit": "roll",
    "widthMm": 1370,
    "heightMm": null,
    "lengthMm": 50000,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "m73-floor-1370x50--all-print-supplies",
        "supplierName": "All Print Supplies",
        "description": "M73-P FL00R10 MATT R10 50 X 1370",
        "price": "199.65",
        "priceUnit": "roll",
        "preferred": true
      }
    ]
  },
  {
    "key": "black-matt-permanent-1230",
    "name": "Permanent Black Matt Vinyl 1230mm",
    "category": "Vinyl",
    "thicknessMm": null,
    "colour": "Black",
    "finish": "Matt",
    "purchaseUnit": "linear_metre",
    "widthMm": 1230,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "black-matt-permanent-1230--all-print-supplies",
        "supplierName": "All Print Supplies",
        "description": "MT BLACK PERM 1230MM",
        "price": "4.05",
        "priceUnit": "linear_metre",
        "preferred": true
      }
    ]
  },
  {
    "key": "dol-1480-matt-1370",
    "name": "Avery DOL 1480 Matt Cast Laminate 1370mm",
    "category": "Laminate",
    "thicknessMm": null,
    "colour": null,
    "finish": "Matt",
    "purchaseUnit": "linear_metre",
    "widthMm": 1370,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "dol-1480-matt-1370--all-print-supplies",
        "supplierName": "All Print Supplies",
        "description": "DOL1480 Z MATT CAST LAM 1370MM",
        "price": "9.45",
        "priceUnit": "linear_metre",
        "preferred": true
      }
    ]
  },
  {
    "key": "mpi-1104-gloss-1370",
    "name": "Avery MPI 1104 Gloss Cast Vinyl 1370mm",
    "category": "Vinyl",
    "thicknessMm": null,
    "colour": "White",
    "finish": "Gloss",
    "purchaseUnit": "linear_metre",
    "widthMm": 1370,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "mpi-1104-gloss-1370--all-print-supplies",
        "supplierName": "All Print Supplies",
        "description": "MPI1104EA WHITE GLOSS CAST 1370MM",
        "price": "9.63",
        "priceUnit": "linear_metre",
        "preferred": true
      }
    ]
  },
  {
    "key": "hp-882-black-5000",
    "name": "HP 882 Black 5000ml",
    "category": "Ink",
    "thicknessMm": null,
    "colour": "Black",
    "finish": null,
    "purchaseUnit": "unit",
    "widthMm": null,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": 5,
    "costingUnit": "litre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "hp-882-black-5000--perfect-colours",
        "supplierName": "Perfect Colours",
        "description": "HP No. 882 Latex Ink Cartridge Black - 5000ml",
        "price": "335.74",
        "priceUnit": "unit",
        "preferred": true
      }
    ]
  },
  {
    "key": "inkjet-90gsm-841x90",
    "name": "Colour Inkjet Paper 90gsm 841mm x 90m",
    "category": "Paper",
    "thicknessMm": null,
    "colour": "White",
    "finish": null,
    "purchaseUnit": "roll",
    "widthMm": 841,
    "heightMm": null,
    "lengthMm": 90000,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "inkjet-90gsm-841x90--perfect-colours",
        "supplierName": "Perfect Colours",
        "description": "Colour Inkjet Paper - 33.1in 841mm x 90m - 90gsm",
        "price": "24.49",
        "priceUnit": "roll",
        "preferred": true
      }
    ]
  },
  {
    "key": "inkjet-90gsm-841x91",
    "name": "Colour Inkjet Paper 90gsm 841mm x 91m",
    "category": "Paper",
    "thicknessMm": null,
    "colour": "White",
    "finish": null,
    "purchaseUnit": "roll",
    "widthMm": 841,
    "heightMm": null,
    "lengthMm": 91000,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "inkjet-90gsm-841x91--perfect-colours",
        "supplierName": "Perfect Colours",
        "description": "Inkjet Paper 90gsm 841mm x 91m",
        "price": "22.15",
        "priceUnit": "roll",
        "preferred": true
      }
    ]
  },
  {
    "key": "su3-70-1560x50",
    "name": "SU3-70 Semi-matt UV Laminate 1560mm x 50m",
    "category": "Laminate",
    "thicknessMm": null,
    "colour": null,
    "finish": "Semi-matt",
    "purchaseUnit": "roll",
    "widthMm": 1560,
    "heightMm": null,
    "lengthMm": 50000,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "su3-70-1560x50--all-print-supplies",
        "supplierName": "All Print Supplies",
        "description": "SU3-70 SEMI-MATT UV SEAL 50M X 1560MM",
        "price": "141.39",
        "priceUnit": "roll",
        "preferred": true
      }
    ]
  },
  {
    "key": "ww300-matt-1371x50",
    "name": "WW300 Matt White 1371mm x 50m",
    "category": "Vinyl",
    "thicknessMm": null,
    "colour": "White",
    "finish": "Matt",
    "purchaseUnit": "roll",
    "widthMm": 1371,
    "heightMm": null,
    "lengthMm": 50000,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "ww300-matt-1371x50--pyramid-display-materials",
        "supplierName": "Pyramid Display Materials",
        "description": "WW300 MATT WHITE 50M X 1371MM",
        "price": "298.62",
        "priceUnit": "roll",
        "preferred": true
      }
    ]
  },
  {
    "key": "easydot-matt-1372x50",
    "name": "Easydot Matt White 1372mm x 50m",
    "category": "Vinyl",
    "thicknessMm": null,
    "colour": "White",
    "finish": "Matt",
    "purchaseUnit": "roll",
    "widthMm": 1372,
    "heightMm": null,
    "lengthMm": 50000,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "easydot-matt-1372x50--all-print-supplies",
        "supplierName": "All Print Supplies",
        "description": "SOLVOPRINT DOT MATT WHITE 50 X 1372",
        "price": "194.16",
        "priceUnit": "roll",
        "preferred": true
      }
    ]
  },
  {
    "key": "ww100-gloss-1371x50",
    "name": "WW100 Pro Gloss White 1371mm x 50m",
    "category": "Vinyl",
    "thicknessMm": null,
    "colour": "White",
    "finish": "Gloss",
    "purchaseUnit": "roll",
    "widthMm": 1371,
    "heightMm": null,
    "lengthMm": 50000,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "ww100-gloss-1371x50--all-print-supplies",
        "supplierName": "All Print Supplies",
        "description": "WW100 PRO GLOSS WHITE 50M X 1371MM",
        "price": "706.55",
        "priceUnit": "roll",
        "preferred": true
      }
    ]
  },
  {
    "key": "lf10700-cast-matt-1370x50",
    "name": "LF10700 Cast Matt UV Laminate 1370mm x 50m",
    "category": "Laminate",
    "thicknessMm": null,
    "colour": null,
    "finish": "Matt",
    "purchaseUnit": "roll",
    "widthMm": 1370,
    "heightMm": null,
    "lengthMm": 50000,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "lf10700-cast-matt-1370x50--all-print-supplies",
        "supplierName": "All Print Supplies",
        "description": "LF10700 CM-UV CAST MT LAM 50 X 1370",
        "price": "497.18",
        "priceUnit": "roll",
        "preferred": true
      }
    ]
  },
  {
    "key": "p65w-silver-crystal-1600",
    "name": "P65W Silver Crystal 1600mm",
    "category": "Vinyl",
    "thicknessMm": null,
    "colour": "Silver",
    "finish": null,
    "purchaseUnit": "linear_metre",
    "widthMm": 1600,
    "heightMm": null,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "p65w-silver-crystal-1600--all-print-supplies",
        "supplierName": "All Print Supplies",
        "description": "P65W SILVER CRYSTAL 1600MM",
        "price": "11.19",
        "priceUnit": "linear_metre",
        "preferred": true
      }
    ]
  },
  {
    "key": "conform-4075-1220",
    "name": "Conform 4075 Application Tape 1220mm",
    "category": "Consumable",
    "thicknessMm": null,
    "colour": null,
    "finish": null,
    "purchaseUnit": "roll",
    "widthMm": 1220,
    "heightMm": null,
    "lengthMm": 91440,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "conform-4075-1220--all-print-supplies",
        "supplierName": "All Print Supplies",
        "description": "4075 CONFORM 100YDS X 1220MM",
        "price": "111.5",
        "priceUnit": "roll",
        "preferred": true
      }
    ]
  },
  {
    "key": "hips-1mm-3050x1524",
    "name": "HIPS 1mm White 3050mm x 1524mm",
    "category": "Board",
    "thicknessMm": 1,
    "colour": "White",
    "finish": "Gloss/matt",
    "purchaseUnit": "sheet",
    "widthMm": 3050,
    "heightMm": 1524,
    "lengthMm": null,
    "inkVolumeLitres": null,
    "costingUnit": "square_metre",
    "costingPackQuantity": null,
    "products": [
      {
        "key": "hips-1mm-3050x1524--ppb",
        "supplierName": "PPB",
        "description": "WHITE 7231 GLOSS/MATT HIPS WITH FILM (ON GLOSS SIDE) 1MM BULK PACK 3050mm x 1524mm",
        "price": "30",
        "priceUnit": "sheet",
        "preferred": true
      }
    ]
  }
]
$medium_catalog$::jsonb;
  v_medium_aliases jsonb := $medium_aliases$
[
  {
    "canonicalName": "Pyramid Display Materials",
    "alias": "Pyramid Display"
  },
  {
    "canonicalName": "Pyramid Display Materials",
    "alias": "Pyramid Display Materials Ltd."
  },
  {
    "canonicalName": "Pyramid Display Materials",
    "alias": "Pyramid Display Materials Ltd"
  },
  {
    "canonicalName": "Antalis",
    "alias": "Antalis Ltd"
  },
  {
    "canonicalName": "Antalis",
    "alias": "Antalis Ltd."
  },
  {
    "canonicalName": "Perfect Colours",
    "alias": "Perfect Colours Ltd"
  },
  {
    "canonicalName": "Perfect Colours",
    "alias": "Perfect Colours Ltd."
  },
  {
    "canonicalName": "PPB",
    "alias": "PPB Ltd"
  },
  {
    "canonicalName": "PPB",
    "alias": "PPB Ltd."
  },
  {
    "canonicalName": "All Print Supplies",
    "alias": "All Print Supplies Ltd"
  },
  {
    "canonicalName": "All Print Supplies",
    "alias": "All Print Supplies Ltd."
  }
]
  $medium_aliases$::jsonb;
  v_version text := 'initial-approved-46';
  v_expected_materials integer := 46;
  v_source_reference text := 'initial-approved-46';
  v_require_papergraphics boolean := true;
  v_protected_identity text := 'foamalite 5mm pvc 3050mm x 1560mm|5000|white||sheet|3050000|1560000|';
  v_protected_id uuid;
  v_create_keys text[];
  v_create_product_keys text[];
  v_catalog_keys text[] := ARRAY[]::text[];
  v_catalog_product_keys text[] := ARRAY[]::text[];
  v_item jsonb;
  v_row jsonb;
  v_requested jsonb;
  v_name text;
  v_normalized text;
  v_supplier_id uuid;
  v_supplier_ids jsonb := '{}'::jsonb;
  v_seen_suppliers jsonb := '{}'::jsonb;
  v_alias text;
  v_canonical text;
  v_alias_id uuid;
  v_should_create boolean;
  v_key text;
  v_description text;
  v_normalized_description text;
  v_identity text;
  v_thickness numeric;
  v_colour text;
  v_width numeric;
  v_height numeric;
  v_length numeric;
  v_finish text;
  v_category text;
  v_ink numeric;
  v_costing_unit text;
  v_costing_pack_quantity numeric;
  v_creating boolean;
  v_material_id uuid;
  v_product jsonb;
  v_product_key text;
  v_product_id uuid;
  v_preferred boolean;
  v_price numeric;
  v_price_unit text;
  v_created_suppliers jsonb := '[]'::jsonb;
  v_matched_suppliers jsonb := '[]'::jsonb;
  v_created_aliases jsonb := '[]'::jsonb;
  v_created_materials jsonb := '[]'::jsonb;
  v_created_prices jsonb := '[]'::jsonb;
  v_summary jsonb;
BEGIN
  IF NOT public.is_approved_candid_admin() THEN
    RAISE EXCEPTION 'Not allowed to import materials'
      USING ERRCODE = '42501';
  END IF;

  v_version := COALESCE(p_payload->>'catalogVersion', '');

  IF v_version = 'medium-approved-batch-2' THEN
    v_catalog := v_medium_catalog;
    v_aliases := v_medium_aliases;
    v_expected_materials := 35;
    v_source_reference := 'medium-approved-batch-2';
    v_require_papergraphics := false;
  ELSIF v_version IS DISTINCT FROM 'initial-approved-46' THEN
    RAISE EXCEPTION 'Unexpected import catalog';
  END IF;

  IF COALESCE(p_payload->>'confirmation', '') IS DISTINCT FROM 'IMPORT APPROVED MATERIALS' THEN
    RAISE EXCEPTION 'Import confirmation is required';
  END IF;

  IF jsonb_array_length(v_catalog) <> v_expected_materials THEN
    RAISE EXCEPTION 'Approved catalog is incomplete';
  END IF;

  BEGIN
    v_effective := (p_payload->>'effectiveDate')::date;
  EXCEPTION
    WHEN others THEN
      RAISE EXCEPTION 'Effective date is not valid';
  END;

  IF v_effective IS NULL
    OR v_effective < DATE '2000-01-01'
    OR v_effective > DATE '2100-12-31' THEN
    RAISE EXCEPTION 'Effective date is not valid';
  END IF;

  SELECT material.id
  INTO v_protected_id
  FROM public.materials AS material
  WHERE material.identity_key = v_protected_identity
  FOR UPDATE;

  IF v_protected_id IS NULL THEN
    RAISE EXCEPTION 'Protected Foamalite record was not found. Import stopped.';
  END IF;

  SELECT COALESCE(array_agg(value), ARRAY[]::text[])
  INTO v_create_keys
  FROM jsonb_array_elements_text(COALESCE(p_payload->'createMaterialKeys', '[]'::jsonb));

  v_create_keys := COALESCE(v_create_keys, ARRAY[]::text[]);

  SELECT COALESCE(array_agg(value), ARRAY[]::text[])
  INTO v_create_product_keys
  FROM jsonb_array_elements_text(COALESCE(p_payload->'createProductKeys', '[]'::jsonb));

  v_create_product_keys := COALESCE(v_create_product_keys, ARRAY[]::text[]);

  IF p_payload->'suppliers' IS NULL OR jsonb_typeof(p_payload->'suppliers') <> 'array' THEN
    RAISE EXCEPTION 'Supplier plan is missing';
  END IF;

  FOR v_row IN
    SELECT value FROM jsonb_array_elements(p_payload->'suppliers')
  LOOP
    v_normalized := lower(regexp_replace(btrim(v_row->>'name'), '\s+', ' ', 'g'));
    v_name := CASE v_normalized
      WHEN 'pyramid display materials' THEN 'Pyramid Display Materials'
      WHEN 'antalis' THEN 'Antalis'
      WHEN 'ppb' THEN 'PPB'
      WHEN 'papergraphics' THEN 'Papergraphics'
      WHEN 'perfect colours' THEN 'Perfect Colours'
      WHEN 'all print supplies' THEN 'All Print Supplies'
      ELSE NULL
    END;

    IF v_name IS NULL THEN
      RAISE EXCEPTION 'Unexpected supplier %', v_row->>'name';
    END IF;

    IF v_seen_suppliers ? v_normalized THEN
      RAISE EXCEPTION 'Duplicate supplier %', v_name;
    END IF;

    v_seen_suppliers := v_seen_suppliers || jsonb_build_object(v_normalized, true);

    SELECT supplier.id
    INTO v_supplier_id
    FROM public.suppliers AS supplier
    WHERE supplier.normalized_name = v_normalized
    FOR UPDATE;

    IF v_row->>'action' = 'create' THEN
      IF v_supplier_id IS NOT NULL THEN
        RAISE EXCEPTION 'Supplier already exists: %', v_name;
      END IF;

      INSERT INTO public.suppliers (name)
      VALUES (v_name)
      RETURNING id INTO v_supplier_id;

      v_created_suppliers := v_created_suppliers || to_jsonb(v_name);
    ELSIF v_row->>'action' = 'match' THEN
      IF v_supplier_id IS NULL
        OR v_supplier_id::text IS DISTINCT FROM v_row->>'expectedId' THEN
        RAISE EXCEPTION 'Supplier match changed: %', v_name;
      END IF;

      v_matched_suppliers := v_matched_suppliers || to_jsonb(v_name);
    ELSE
      RAISE EXCEPTION 'Unknown supplier action';
    END IF;

    v_supplier_ids := v_supplier_ids || jsonb_build_object(v_name, v_supplier_id);
  END LOOP;

  IF v_require_papergraphics THEN
    IF NOT (
      v_seen_suppliers ? 'pyramid display materials'
      AND v_seen_suppliers ? 'antalis'
      AND v_seen_suppliers ? 'ppb'
      AND v_seen_suppliers ? 'papergraphics'
      AND v_seen_suppliers ? 'perfect colours'
      AND v_seen_suppliers ? 'all print supplies'
      AND (SELECT count(*) FROM jsonb_object_keys(v_seen_suppliers)) = 6
    ) THEN
      RAISE EXCEPTION 'Initial import must account for every approved supplier';
    END IF;
  ELSIF NOT (
    v_seen_suppliers ? 'pyramid display materials'
    AND v_seen_suppliers ? 'antalis'
    AND v_seen_suppliers ? 'ppb'
    AND v_seen_suppliers ? 'perfect colours'
    AND v_seen_suppliers ? 'all print supplies'
    AND NOT (v_seen_suppliers ? 'papergraphics')
    AND (SELECT count(*) FROM jsonb_object_keys(v_seen_suppliers)) = 5
  ) THEN
    RAISE EXCEPTION 'Batch import must account for every approved supplier';
  END IF;

  IF (
    SELECT count(*)
    FROM jsonb_array_elements(v_aliases) AS known
  ) <> (
    SELECT count(DISTINCT lower(regexp_replace(btrim(known.value->>'alias'), '\s+', ' ', 'g')))
    FROM jsonb_array_elements(v_aliases) AS known
  ) THEN
    RAISE EXCEPTION 'Approved supplier aliases are not unique after normalisation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT count(DISTINCT lower(regexp_replace(btrim(known.value->>'canonicalName'), '\s+', ' ', 'g'))) AS suppliers
      FROM jsonb_array_elements(v_aliases) AS known
      GROUP BY lower(regexp_replace(btrim(known.value->>'alias'), '\s+', ' ', 'g'))
    ) AS grouped
    WHERE grouped.suppliers > 1
  ) THEN
    RAISE EXCEPTION 'Supplier alias is claimed by more than one supplier';
  END IF;

  FOR v_requested IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_payload->'createAliases', '[]'::jsonb))
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_aliases) AS known
      WHERE lower(regexp_replace(btrim(known.value->>'alias'), '\s+', ' ', 'g'))
          = lower(regexp_replace(btrim(v_requested->>'alias'), '\s+', ' ', 'g'))
        AND lower(regexp_replace(btrim(known.value->>'canonicalName'), '\s+', ' ', 'g'))
          = lower(regexp_replace(btrim(v_requested->>'canonicalName'), '\s+', ' ', 'g'))
    ) THEN
      RAISE EXCEPTION 'Unexpected supplier alias';
    END IF;
  END LOOP;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_aliases)
  LOOP
    v_alias := regexp_replace(btrim(v_item->>'alias'), '\s+', ' ', 'g');
    v_canonical := regexp_replace(btrim(v_item->>'canonicalName'), '\s+', ' ', 'g');
    v_supplier_id := (v_supplier_ids->>v_canonical)::uuid;
    v_normalized := lower(v_alias);

    IF v_supplier_id IS NULL THEN
      RAISE EXCEPTION 'Alias supplier was not resolved: %', v_canonical;
    END IF;

    v_should_create := EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(p_payload->'createAliases', '[]'::jsonb)) AS requested
      WHERE lower(regexp_replace(btrim(requested.value->>'alias'), '\s+', ' ', 'g')) = v_normalized
        AND lower(regexp_replace(btrim(requested.value->>'canonicalName'), '\s+', ' ', 'g')) = lower(v_canonical)
    );

    SELECT alias_row.id
    INTO v_alias_id
    FROM public.supplier_aliases AS alias_row
    WHERE alias_row.normalized_alias = v_normalized;

    IF v_should_create THEN
      IF v_alias_id IS NOT NULL THEN
        RAISE EXCEPTION 'Supplier alias already exists: %', v_alias;
      END IF;

      INSERT INTO public.supplier_aliases (supplier_id, alias)
      VALUES (v_supplier_id, v_alias);

      v_created_aliases := v_created_aliases || jsonb_build_array(
        jsonb_build_object('canonicalName', v_canonical, 'alias', v_alias)
      );
    ELSE
      IF v_alias_id IS NULL THEN
        RAISE EXCEPTION 'Supplier alias is missing: %', v_alias;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM public.supplier_aliases AS alias_row
        WHERE alias_row.id = v_alias_id
          AND alias_row.supplier_id = v_supplier_id
      ) THEN
        RAISE EXCEPTION 'Supplier alias points at a different supplier: %', v_alias;
      END IF;
    END IF;
  END LOOP;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_catalog)
  LOOP
    v_key := v_item->>'key';
    v_name := regexp_replace(btrim(v_item->>'name'), '\s+', ' ', 'g');
    v_thickness := (v_item->>'thicknessMm')::numeric;
    v_colour := NULLIF(v_item->>'colour', '');
    v_finish := NULLIF(v_item->>'finish', '');
    v_category := NULLIF(v_item->>'category', '');
    v_ink := (v_item->>'inkVolumeLitres')::numeric;
    v_costing_unit := NULLIF(v_item->>'costingUnit', '');
    v_costing_pack_quantity := (v_item->>'costingPackQuantity')::numeric;
    v_width := (v_item->>'widthMm')::numeric;
    v_height := (v_item->>'heightMm')::numeric;
    v_length := (v_item->>'lengthMm')::numeric;
    v_catalog_keys := array_append(v_catalog_keys, v_key);
    v_creating := v_key = ANY(v_create_keys);

    IF v_item->>'purchaseUnit' NOT IN ('sheet', 'roll', 'unit', 'pack', 'linear_metre', 'square_metre') THEN
      RAISE EXCEPTION 'Unexpected purchase unit: %', v_name;
    END IF;

    IF jsonb_typeof(v_item->'products') <> 'array'
      OR jsonb_array_length(v_item->'products') < 1 THEN
      RAISE EXCEPTION 'Material has no supplier products: %', v_name;
    END IF;

    IF (
      SELECT count(*)
      FROM jsonb_array_elements(v_item->'products') AS product
      WHERE COALESCE((product.value->>'preferred')::boolean, false)
    ) <> 1 THEN
      RAISE EXCEPTION 'Material must have one preferred supplier product: %', v_name;
    END IF;

    v_identity := public.material_identity_key(
      v_name,
      v_thickness,
      v_colour,
      v_finish,
      v_item->>'purchaseUnit',
      v_width,
      v_height,
      v_length
    );

    IF v_identity = v_protected_identity THEN
      RAISE EXCEPTION 'Protected Foamalite record cannot be imported';
    END IF;

    SELECT material.id
    INTO v_material_id
    FROM public.materials AS material
    WHERE material.identity_key = v_identity
    FOR UPDATE;

    IF v_creating THEN
      IF v_material_id IS NOT NULL THEN
        RAISE EXCEPTION 'Material already exists: %', v_name;
      END IF;

      INSERT INTO public.materials (
        name,
        category,
        thickness_mm,
        colour,
        finish,
        purchase_unit,
        purchase_width_mm,
        purchase_height_mm,
        purchase_length_mm,
        ink_volume_litres,
        costing_unit,
        costing_pack_quantity,
        identity_key,
        active
      )
      VALUES (
        v_name,
        v_category,
        v_thickness,
        v_colour,
        v_finish,
        v_item->>'purchaseUnit',
        v_width,
        v_height,
        v_length,
        v_ink,
        v_costing_unit,
        v_costing_pack_quantity,
        '',
        true
      )
      RETURNING id INTO v_material_id;

      v_created_materials := v_created_materials || to_jsonb(v_name);
    ELSE
      IF v_material_id IS NULL THEN
        RAISE EXCEPTION 'Approved material is missing from the create list: %', v_name;
      END IF;
    END IF;

    FOR v_product IN
      SELECT value FROM jsonb_array_elements(v_item->'products')
    LOOP
      v_product_key := v_product->>'key';
      v_description := regexp_replace(btrim(v_product->>'description'), '\s+', ' ', 'g');
      v_normalized_description := lower(v_description);
      v_canonical := regexp_replace(btrim(v_product->>'supplierName'), '\s+', ' ', 'g');
      v_supplier_id := (v_supplier_ids->>v_canonical)::uuid;
      v_preferred := COALESCE((v_product->>'preferred')::boolean, false);
      v_price := (v_product->>'price')::numeric;
      v_price_unit := v_product->>'priceUnit';
      v_catalog_product_keys := array_append(v_catalog_product_keys, v_product_key);
      v_product_id := NULL;

      IF v_supplier_id IS NULL THEN
        RAISE EXCEPTION 'Material supplier was not resolved: %', v_name;
      END IF;

      IF v_price IS NULL OR v_price <= 0 THEN
        RAISE EXCEPTION 'Opening price must be greater than zero: %', v_name;
      END IF;

      IF v_price_unit IS DISTINCT FROM v_item->>'purchaseUnit' THEN
        RAISE EXCEPTION 'Price unit does not match the purchase unit: %', v_name;
      END IF;

      IF v_normalized_description IN (
        '5mm 3050x1560mm white p/e foamalite xpress foam pvc',
        '5mm 3050x1560mm white p/e foamalite xpress foam pvc (pq80)'
      ) THEN
        RAISE EXCEPTION 'Protected Foamalite description cannot be imported';
      END IF;

      IF v_creating OR v_product_key = ANY(v_create_product_keys) THEN
        IF v_creating AND v_product_key <> ALL(v_create_product_keys) THEN
          RAISE EXCEPTION 'New material is missing a supplier product in the create list: %', v_name;
        END IF;

        SELECT product.id
        INTO v_product_id
        FROM public.material_supplier_products AS product
        WHERE product.supplier_id = v_supplier_id
          AND product.normalized_description = v_normalized_description
        FOR UPDATE;

        IF v_product_id IS NOT NULL THEN
          RAISE EXCEPTION 'Supplier product already exists: %', v_name;
        END IF;

        IF v_preferred AND EXISTS (
          SELECT 1
          FROM public.material_supplier_products AS product
          WHERE product.material_id = v_material_id
            AND product.is_preferred
            AND product.active
        ) THEN
          RAISE EXCEPTION 'Preferred supplier product already exists: %', v_name;
        END IF;

        INSERT INTO public.material_supplier_products (
          material_id,
          supplier_id,
          supplier_sku,
          supplier_description,
          normalized_description,
          is_preferred,
          active
        )
        VALUES (
          v_material_id,
          v_supplier_id,
          NULL,
          v_description,
          v_normalized_description,
          v_preferred,
          true
        )
        RETURNING id INTO v_product_id;

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
          v_product_id,
          v_price,
          'GBP',
          v_price_unit,
          v_effective,
          auth.uid(),
          'initial_spreadsheet_import',
          v_source_reference
        );

        v_created_prices := v_created_prices || jsonb_build_array(
          jsonb_build_object(
            'name', v_name,
            'supplier', v_canonical,
            'price', v_price,
            'priceUnit', v_price_unit
          )
        );
      ELSE
        SELECT product.id
        INTO v_product_id
        FROM public.material_supplier_products AS product
        WHERE product.material_id = v_material_id
          AND product.supplier_id = v_supplier_id
          AND product.normalized_description = v_normalized_description
        FOR UPDATE;

        IF v_product_id IS NULL THEN
          RAISE EXCEPTION 'Existing material does not have the approved supplier product: %', v_name;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM public.material_prices AS price
          WHERE price.material_supplier_product_id = v_product_id
            AND price.price_unit = v_price_unit
            AND abs(price.price - v_price) <= 0.02
        ) THEN
          RAISE EXCEPTION 'Existing price does not match the approved opening price: %', v_name;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_create_product_keys) AS create_key
    WHERE create_key <> ALL(v_catalog_product_keys)
  ) THEN
    RAISE EXCEPTION 'Import contains a supplier product outside the approved catalog';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_create_keys) AS create_key
    WHERE create_key <> ALL(v_catalog_keys)
  ) THEN
    RAISE EXCEPTION 'Import contains a material outside the approved catalog';
  END IF;

  v_summary := jsonb_build_object(
    'catalogVersion', v_version,
    'effectiveDate', v_effective,
    'createdSuppliers', v_created_suppliers,
    'matchedSuppliers', v_matched_suppliers,
    'createdAliases', v_created_aliases,
    'createdMaterials', v_created_materials,
    'createdPrices', v_created_prices,
    'preservedMaterialId', v_protected_id
  );

  INSERT INTO public.material_import_runs (
    catalog_version,
    imported_by,
    summary
  )
  VALUES (
    v_version,
    auth.uid(),
    v_summary
  );

  RETURN v_summary;
END;
$$;


COMMIT;


GRANT EXECUTE ON FUNCTION public.apply_initial_materials_import(jsonb) TO authenticated;

COMMIT;
