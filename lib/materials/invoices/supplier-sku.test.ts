import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { historicalPriceDecision } from "@/lib/materials/invoices/historical-price";
import { classifyInvoiceLine } from "@/lib/materials/invoices/match";
import type { InvoiceMatchProduct } from "@/lib/materials/invoices/model";
import { supplierSkuReviewState, supplierSkuSuggestion } from "@/lib/materials/invoices/supplier-sku";
import type { ApprovedPriceRecord } from "@/lib/materials/pricing";

const DESCRIPTION = "5mm 1220x2440mm White P/E Foamalite Xpress Foam PVC (PQ120)";

function product(overrides: Partial<InvoiceMatchProduct> = {}): InvoiceMatchProduct {
  return {
    id: "product-1",
    supplierId: "pyramid",
    sku: null,
    description: DESCRIPTION,
    materialName: "Foamalite 5mm PVC 2440mm x 1220mm",
    purchaseUnit: "sheet",
    thicknessMm: 5,
    colour: "White",
    widthMm: 1220,
    heightMm: 2440,
    lengthMm: null,
    currentPrice: 25.99,
    currentPriceUnit: "sheet",
    currentPriceId: "price-1",
    currentEffectiveDate: "2026-10-01",
    ...overrides,
  };
}

function suggest(overrides: {
  description?: string;
  rawSupplierSku?: string | null;
  product?: InvoiceMatchProduct | null;
  products?: InvoiceMatchProduct[];
  mappings?: { supplierId: string; normalizedDescription: string; productId: string }[];
  confidence?: "high" | "medium" | null;
  method?: "description" | "mapping" | "specification" | "sku" | null;
  supplierId?: string | null;
  processingStatus?: string | null;
  unit?: string | null;
} = {}) {
  const item = overrides.product === undefined ? product() : overrides.product;
  return supplierSkuSuggestion({
    processingStatus: overrides.processingStatus === undefined ? "processed" : overrides.processingStatus,
    supplierId: overrides.supplierId === undefined ? "pyramid" : overrides.supplierId,
    description: overrides.description ?? DESCRIPTION,
    rawSupplierSku: overrides.rawSupplierSku === undefined ? "FLXP52412PE" : overrides.rawSupplierSku,
    unit: overrides.unit === undefined ? "sheet" : overrides.unit,
    matchConfidence: overrides.confidence === undefined ? "high" : overrides.confidence,
    matchMethod: overrides.method === undefined ? "description" : overrides.method,
    matchedProductId: item?.id ?? "product-1",
    product: item,
    supplierProducts: overrides.products ?? [item].filter((value): value is InvoiceMatchProduct => value != null),
    mappings: overrides.mappings ?? [],
  });
}

test("an ignored invoice is not offered a supplier SKU", () => {
  assert.deepEqual(suggest({ processingStatus: "ignored" }), { ok: false, code: "ignored" });
  assert.deepEqual(
    supplierSkuReviewState({
      processingStatus: "ignored",
      approvedSku: null,
      suggestedSku: "FLXP52412PE",
    }),
    { approvedSku: null, suggestedSku: null }
  );
});

test("a saved catalogue SKU is shown as approved and has no suggestion", () => {
  assert.deepEqual(
    supplierSkuReviewState({
      processingStatus: "processed",
      approvedSku: "FLXP52412PE",
      suggestedSku: "FLXP52412PE",
    }),
    { approvedSku: "FLXP52412PE", suggestedSku: null }
  );
});

test("a unit mismatch is rejected", () => {
  assert.deepEqual(suggest({ unit: "roll" }), { ok: false, code: "unit" });
  assert.deepEqual(suggest({ unit: null }), { ok: false, code: "unit" });
});

test("sheet and roll sizes use either dimension order", () => {
  const first = "5mm 1220mm x 2440mm White P/E Foamalite Xpress Foam PVC (PQ120)";
  const second = "5mm 1220mm x 2440 White P/E Foamalite Xpress Foam PVC (PQ120)";
  const third = "5mm 2440 x 1220mm White P/E Foamalite Xpress Foam PVC (PQ120)";
  const conflict = "5mm 3050 x 1560mm White P/E Foamalite Xpress Foam PVC (PQ120)";

  assert.equal(suggest({ description: first, product: product({ description: first }) }).ok, true);
  assert.equal(suggest({ description: second, product: product({ description: second }) }).ok, true);
  assert.equal(suggest({ description: third, product: product({ description: third }) }).ok, true);
  assert.deepEqual(
    suggest({
      description: conflict,
      method: "mapping",
      mappings: [
        {
          supplierId: "pyramid",
          normalizedDescription: conflict.toLowerCase(),
          productId: "product-1",
        },
      ],
    }),
    { ok: false, code: "specification" }
  );

  const along = "Briteline 1370mm x 50m";
  const reversed = "Briteline 50m x 1370mm";
  const wider = "Briteline 50m x 1600mm";
  const roll = product({
    purchaseUnit: "roll",
    widthMm: 1370,
    heightMm: null,
    lengthMm: 50000,
    thicknessMm: null,
    description: along,
    materialName: "Briteline vinyl",
  });

  assert.equal(suggest({ description: along, unit: "roll", product: roll }).ok, true);
  assert.equal(
    suggest({
      description: reversed,
      unit: "roll",
      product: roll,
      method: "mapping",
      mappings: [
        { supplierId: "pyramid", normalizedDescription: reversed.toLowerCase(), productId: "product-1" },
      ],
    }).ok,
    true
  );
  assert.deepEqual(
    suggest({
      description: wider,
      unit: "roll",
      product: roll,
      method: "mapping",
      mappings: [
        { supplierId: "pyramid", normalizedDescription: wider.toLowerCase(), productId: "product-1" },
      ],
    }),
    { ok: false, code: "specification" }
  );
});

test("material families agree, conflict, combine, or stay absent", () => {
  const foam = "5mm 1220mm x 2440mm Foamalite";
  assert.equal(
    suggest({
      description: foam,
      product: product({ description: foam, materialName: "Foamalite board" }),
    }).ok,
    true
  );

  const dibond = "5mm 1220mm x 2440mm Dibond";
  assert.deepEqual(
    suggest({
      description: dibond,
      method: "mapping",
      product: product({ description: foam, materialName: "Foamalite board" }),
      mappings: [
        { supplierId: "pyramid", normalizedDescription: dibond.toLowerCase(), productId: "product-1" },
      ],
    }),
    { ok: false, code: "specification" }
  );

  const combined = "Foamalite vinyl 1220mm x 2440mm";
  assert.equal(
    suggest({
      description: combined,
      method: "mapping",
      product: product({
        description: "Foamalite 1220mm x 2440mm",
        materialName: "Foamalite board",
        thicknessMm: null,
      }),
      mappings: [
        { supplierId: "pyramid", normalizedDescription: combined.toLowerCase(), productId: "product-1" },
      ],
    }).ok,
    true
  );

  const plain = "Plain board 1220mm x 2440mm";
  assert.equal(
    suggest({
      description: plain,
      product: product({ description: plain, materialName: "Plain board", thicknessMm: null }),
    }).ok,
    true
  );
});

test("an exact description match suggests the invoice line SKU", () => {
  const suggestion = suggest();
  assert.deepEqual(suggestion, { ok: true, sku: "FLXP52412PE" });
});

test("a confirmed description mapping can suggest a SKU when the catalogue wording differs", () => {
  const suggestion = suggest({
    description: "5mm 3050x1560mm White P/E Foamalite Xpress Foam PVC (PQ80)",
    rawSupplierSku: "FLXP53015PE",
    method: "mapping",
    product: product({
      description: "5mm 3050x1560mm White P/E Foamalite Xpress Foam PVC",
      widthMm: 1560,
      heightMm: 3050,
    }),
    mappings: [
      {
        supplierId: "pyramid",
        normalizedDescription: "5mm 3050x1560mm white p/e foamalite xpress foam pvc (pq80)",
        productId: "product-1",
      },
    ],
  });

  assert.deepEqual(suggestion, { ok: true, sku: "FLXP53015PE" });
});

test("a parenthetical description code is never used as the SKU", () => {
  const withLineSku = suggest();
  const withoutLineSku = suggest({ rawSupplierSku: null });
  const blankLineSku = suggest({ rawSupplierSku: "   " });

  assert.equal(withLineSku.ok && withLineSku.sku, "FLXP52412PE");
  assert.equal(withLineSku.ok && withLineSku.sku.includes("PQ"), false);
  assert.deepEqual(withoutLineSku, { ok: false, code: "sku" });
  assert.deepEqual(blankLineSku, { ok: false, code: "sku" });
});

test("an ambiguous or medium match is not given a SKU suggestion", () => {
  assert.equal(suggest({ method: "specification" }).ok, false);
  assert.equal(suggest({ method: "sku" }).ok, false);
  assert.equal(suggest({ confidence: "medium" }).ok, false);
  assert.equal(suggest({ product: null }).ok, false);
});

test("a duplicate supplier SKU and a conflicting specification are rejected", () => {
  const other = product({ id: "product-2", sku: "FLXP52412PE", description: "Another board" });
  assert.deepEqual(suggest({ products: [product(), other] }), { ok: false, code: "duplicate" });

  const wrongSize = suggest({
    description: "5mm 3050x1560mm White P/E Foamalite Xpress Foam PVC",
    method: "mapping",
    mappings: [
      {
        supplierId: "pyramid",
        normalizedDescription: "5mm 3050x1560mm white p/e foamalite xpress foam pvc",
        productId: "product-1",
      },
    ],
  });
  assert.deepEqual(wrongSize, { ok: false, code: "specification" });

  const wrongFamily = suggest({
    description: "5mm 1220x2440mm Dibond",
    method: "mapping",
    mappings: [
      {
        supplierId: "pyramid",
        normalizedDescription: "5mm 1220x2440mm dibond",
        productId: "product-1",
      },
    ],
  });
  assert.deepEqual(wrongFamily, { ok: false, code: "specification" });
});

test("a populated catalogue SKU and the wrong supplier are not suggested again", () => {
  assert.deepEqual(suggest({ product: product({ sku: "FLXP52412PE" }) }), { ok: false, code: "product" });
  assert.equal(suggest({ supplierId: "antalis" }).ok, false);
});

test("confirming the SKU makes a historical price eligible for Rule A", () => {
  const prices: ApprovedPriceRecord[] = [
    {
      id: "price-1",
      price: 25.99,
      priceUnit: "sheet",
      effectiveDate: "2026-10-01",
      approvedAt: "2026-10-01T00:00:00.000Z",
      createdAt: "2026-10-01T00:00:00.000Z",
    },
  ];
  const before = product();
  const line = classifyInvoiceLine({
    line: {
      lineNumber: 1,
      rawDescription: DESCRIPTION,
      rawSupplierSku: "FLXP52412PE",
      rawQuantity: 1,
      rawUnit: "sheet",
      rawUnitPrice: 26.13,
      rawLineTotal: 26.13,
      rawTax: null,
    },
    supplierId: "pyramid",
    products: [before],
    mappings: [],
    ignoreRules: [],
  });
  const blocked = historicalPriceDecision({
    extractionStatus: "extracted",
    invoiceDate: "2026-07-14",
    supplierId: "pyramid",
    line,
    product: before,
    productActive: true,
    supplierProducts: [before],
    mappings: [],
    prices,
  });
  const confirmed = product({ sku: "FLXP52412PE" });
  const eligible = historicalPriceDecision({
    extractionStatus: "extracted",
    invoiceDate: "2026-07-14",
    supplierId: "pyramid",
    line: { ...line, matchedProductId: confirmed.id },
    product: confirmed,
    productActive: true,
    supplierProducts: [confirmed],
    mappings: [],
    prices,
  });

  assert.deepEqual(blocked, { retain: false, code: "sku" });
  assert.equal(eligible.retain, true);
  assert.equal(prices[0]?.price, 25.99);
  assert.equal(before.sku, null);
  assert.equal(before.thicknessMm, 5);
  assert.equal(before.widthMm, 1220);
});

test("the supplier SKU migration only writes the blank SKU and its audit row", async () => {
  const sql = await readFile(
    new URL("../../../supabase/migrations/20261027143000_supplier_sku_confirmation.sql", import.meta.url),
    "utf8"
  );
  const decision = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.confirm_supplier_sku"),
    sql.indexOf("ALTER TABLE public.supplier_sku_confirmations ENABLE ROW LEVEL SECURITY")
  );
  const retryAt = decision.indexOf("'alreadyConfirmed', true");
  const updateAt = decision.indexOf("UPDATE public.material_supplier_products");
  const insertAt = decision.indexOf("INSERT INTO public.supplier_sku_confirmations");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.supplier_sku_confirmations/);
  assert.match(sql, /supplier_sku_confirmations_supplier_sku_idx/);
  assert.match(sql, /supplier_invoice_events_one_supplier_sku_idx/);
  assert.match(decision, /SECURITY DEFINER/);
  assert.match(decision, /SET search_path = pg_catalog, public, pg_temp/);
  assert.match(decision, /public\.is_approved_candid_admin\(\)/);
  assert.match(decision, /auth\.uid\(\) IS DISTINCT FROM p_actor_id/);
  assert.match(decision, /normalize_material_label\(v_line\.raw_supplier_sku\)/);
  assert.match(decision, /The confirmed SKU must be the SKU printed on the invoice line/);
  assert.match(decision, /This supplier SKU is already used by another product/);
  assert.match(decision, /Another invoice line records a different SKU for this product/);
  assert.match(decision, /This SKU is already matched to a different supplier product/);
  assert.match(decision, /The supplier product match is not verified/);
  assert.match(decision, /The invoice line conflicts with the product specification/);
  assert.match(decision, /The invoice unit does not match the material purchase unit/);
  assert.match(decision, /An ignored invoice cannot confirm a supplier SKU/);
  assert.equal(decision.split("processing_status IS DISTINCT FROM 'ignored'").length - 1, 2);
  const ignoredAt = decision.indexOf("v_invoice.processing_status = 'ignored'");
  assert.ok(ignoredAt > 0 && ignoredAt < retryAt);
  assert.match(sql, /1220mm x 2440/);
  assert.match(sql, /50m x 1370mm/);
  const families = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.supplier_sku_details_conflict"),
    sql.indexOf("CREATE OR REPLACE FUNCTION public.confirm_supplier_sku")
  );
  assert.equal(families.split("pg_catalog.array_append").length - 1, 14);
  assert.doesNotMatch(families, /_families \|\| '/);
  const correction = await readFile(
    new URL("../../../supabase/migrations/20261027173000_supplier_sku_family_array.sql", import.meta.url),
    "utf8"
  );
  assert.match(correction, /CREATE OR REPLACE FUNCTION public\.supplier_sku_details_conflict/);
  assert.equal(correction.split("pg_catalog.array_append").length - 1, 14);
  assert.doesNotMatch(correction, /_families \|\| '/);
  assert.match(correction, /LANGUAGE plpgsql/);
  assert.match(correction, /IMMUTABLE/);
  assert.match(correction, /SET search_path = pg_catalog, public, pg_temp/);
  assert.doesNotMatch(correction, /SECURITY DEFINER|GRANT |DELETE ON/);
  const guard = await readFile(
    new URL("../../../supabase/migrations/20261027220000_supplier_sku_column_privilege.sql", import.meta.url),
    "utf8"
  );
  const columnGrant = guard.slice(guard.indexOf("GRANT UPDATE"), guard.lastIndexOf("COMMIT"));
  assert.match(guard, /CREATE OR REPLACE FUNCTION public\.guard_material_supplier_product_sku/);
  assert.match(guard, /A confirmed supplier SKU cannot be changed/);
  assert.match(guard, /REVOKE UPDATE ON TABLE public\.material_supplier_products FROM authenticated, service_role/);
  assert.match(columnGrant, /material_id/);
  assert.match(columnGrant, /supplier_id/);
  assert.match(columnGrant, /supplier_description/);
  assert.match(columnGrant, /normalized_description/);
  assert.match(columnGrant, /is_preferred/);
  assert.match(columnGrant, /active/);
  assert.doesNotMatch(columnGrant, /supplier_sku/);
  assert.doesNotMatch(guard, /PG_CONTEXT|current_user|set_config\(|SECURITY DEFINER|DELETE ON|material_prices/);
  assert.match(sql, /guard_material_supplier_product_sku/);
  assert.match(sql, /BEFORE UPDATE OF supplier_sku/);
  assert.doesNotMatch(sql, /BEFORE INSERT[\s\S]{0,120}guard_material_supplier_product_sku/);
  assert.match(sql, /current_user IS DISTINCT FROM v_owner/);
  assert.match(sql, /A supplier SKU can only be saved by confirming an invoice line/);
  assert.doesNotMatch(sql, /set_config\(/);
  assert.match(decision, /previous_sku/);
  assert.match(decision, /'confirmedSku', v_sku/);
  assert.match(decision, /'supplier_sku_confirmed'/);
  assert.ok(retryAt > 0 && retryAt < updateAt && retryAt < insertAt);
  assert.doesNotMatch(decision, /UPDATE public\.materials|UPDATE public\.material_prices|INSERT INTO public\.material_prices|UPDATE public\.supplier_invoices|UPDATE public\.supplier_invoice_lines/);
  assert.doesNotMatch(decision, /EXCEPTION\s+WHEN/);
  assert.doesNotMatch(sql, /gmail_auto_processing_enabled|invoice_processing_runs/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.confirm_supplier_sku/);
  assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.confirm_supplier_sku[\s\S]*TO anon/);
});

test("only an approved administrator can reach the confirmation action", async () => {
  const actions = await readFile(new URL("./actions.ts", import.meta.url), "utf8");
  const review = actions.slice(actions.indexOf("export async function reviewInvoiceLine"), actions.indexOf("export async function addInvoiceLine"));
  const confirmation = actions.slice(
    actions.indexOf("async function confirmSupplierSku"),
    actions.indexOf("async function confirmLineMatch")
  );

  assert.match(review, /requireAdmin\(\)/);
  assert.match(review, /action === "confirm_supplier_sku"/);
  assert.match(confirmation, /rpc\("confirm_supplier_sku"/);
  assert.match(confirmation, /p_actor_id: access\.userId/);
  assert.doesNotMatch(confirmation, /from\("material_prices"\)|from\("materials"\)|from\("material_supplier_products"\)/);

  const materials = await readFile(new URL("../actions.ts", import.meta.url), "utf8");
  const createProduct = materials.slice(
    materials.indexOf("export async function createSupplierProductRecord"),
    materials.indexOf("export async function updateSupplierProductRecord")
  );
  const updateProduct = materials.slice(
    materials.indexOf("export async function updateSupplierProductRecord"),
    materials.indexOf("export async function createApprovedPriceRecord")
  );

  assert.match(createProduct, /supplier_sku: parsed\.supplierSku/);
  assert.doesNotMatch(updateProduct, /supplier_sku:/);

  const panel = await readFile(
    new URL("../../../components/materials/invoice-review-panel.tsx", import.meta.url),
    "utf8"
  );
  const suggestion = panel.slice(
    panel.indexOf("function SupplierSkuSuggestion"),
    panel.indexOf("function PriceChangePanel")
  );
  const approvedAt = suggestion.indexOf("Approved supplier SKU:");
  const suggestedAt = suggestion.indexOf("Suggested supplier SKU:");
  const buttonAt = suggestion.indexOf("Confirm supplier SKU");

  assert.ok(approvedAt > 0 && approvedAt < suggestedAt && suggestedAt < buttonAt);
  assert.match(suggestion, /router\.refresh\(\)/);
  assert.match(suggestion, /processingStatus: invoiceIgnored \? "ignored"/);
});
