import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { classifyDocumentRelevance, promotionQueue } from "@/lib/gmail/relevance";
import { findDuplicateInvoice } from "@/lib/materials/invoices/duplicate";
import { retainHistoricalPriceLines } from "@/lib/materials/invoices/gmail-promotion";
import {
  HISTORICAL_PRICE_REASON,
  HISTORICAL_PRICE_RULE,
  historicalPriceDecision,
} from "@/lib/materials/invoices/historical-price";
import { classifyInvoiceLine } from "@/lib/materials/invoices/match";
import { formatPriceDecision } from "@/lib/materials/invoices/price-change";
import type { ClassifiedLine, InvoiceMatchProduct } from "@/lib/materials/invoices/model";
import type { ApprovedPriceRecord } from "@/lib/materials/pricing";

const DESCRIPTION = "5mm 1220x2440mm White Foamalite";

function product(overrides: Partial<InvoiceMatchProduct> = {}): InvoiceMatchProduct {
  return {
    id: "product-1",
    supplierId: "pyramid",
    sku: "FLXP52412PE",
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

function price(overrides: Partial<ApprovedPriceRecord> = {}): ApprovedPriceRecord {
  return {
    id: "price-1",
    price: 25.99,
    priceUnit: "sheet",
    effectiveDate: "2026-10-01",
    approvedAt: "2026-10-01T13:43:47.000Z",
    createdAt: "2026-10-01T13:43:47.000Z",
    ...overrides,
  };
}

function classify(input: {
  unitPrice?: number;
  sku?: string | null;
  description?: string;
  products?: InvoiceMatchProduct[];
  mappings?: { supplierId: string; normalizedDescription: string; productId: string }[];
  quantity?: number;
  lineTotal?: number;
} = {}) {
  const unitPrice = input.unitPrice ?? 26.13;
  return classifyInvoiceLine({
    line: {
      lineNumber: 1,
      rawDescription: input.description ?? DESCRIPTION,
      rawSupplierSku: input.sku === undefined ? "FLXP52412PE" : input.sku,
      rawQuantity: input.quantity ?? 1,
      rawUnit: "SHEET",
      rawUnitPrice: unitPrice,
      rawLineTotal: input.lineTotal ?? unitPrice,
      rawTax: null,
    },
    supplierId: "pyramid",
    products: input.products ?? [product()],
    mappings: input.mappings ?? [],
    ignoreRules: [],
  });
}

function decide(input: {
  line?: ClassifiedLine;
  invoiceDate?: string | null;
  products?: InvoiceMatchProduct[];
  product?: InvoiceMatchProduct | null;
  prices?: ApprovedPriceRecord[];
  extractionStatus?: "extracted" | "failed" | "needs_ocr";
  productActive?: boolean;
  supplierId?: string | null;
  mappings?: { supplierId: string; normalizedDescription: string; productId: string }[];
} = {}) {
  const chosen = input.product === undefined ? (input.products ?? [product()])[0] : input.product;
  return historicalPriceDecision({
    extractionStatus: input.extractionStatus ?? "extracted",
    invoiceDate: input.invoiceDate === undefined ? "2026-07-14" : input.invoiceDate,
    supplierId: input.supplierId === undefined ? "pyramid" : input.supplierId,
    line: input.line ?? classify(),
    product: chosen,
    productActive: input.productActive ?? true,
    supplierProducts: input.products ?? [chosen].filter((item): item is InvoiceMatchProduct => item != null),
    mappings: input.mappings ?? [],
    prices: input.prices ?? [price()],
  });
}

test("an older verified price difference retains the current price", () => {
  const line = classify();
  const decision = decide({ line });

  assert.equal(line.matchConfidence, "high");
  assert.equal(line.reviewStatus, "price_change");
  assert.equal(decision.retain, true);
  if (decision.retain) {
    assert.equal(decision.rule, HISTORICAL_PRICE_RULE);
    assert.equal(decision.reason, HISTORICAL_PRICE_REASON);
    assert.equal(decision.invoicePrice, 26.13);
    assert.equal(decision.currentPrice, 25.99);
    assert.equal(decision.priceId, "price-1");
    assert.equal(decision.productId, "product-1");
    assert.equal(decision.invoiceDate, "2026-07-14");
    assert.equal(decision.effectiveDate, "2026-10-01");
  }
});

test("a newer higher price stays for manual review", () => {
  const decision = decide({ invoiceDate: "2026-10-15", line: classify({ unitPrice: 27 }) });
  assert.deepEqual(decision, { retain: false, code: "date" });
});

test("a same-day price difference stays for manual review", () => {
  const decision = decide({ invoiceDate: "2026-10-01", line: classify({ unitPrice: 27 }) });
  assert.deepEqual(decision, { retain: false, code: "date" });
});

test("a one-penny difference on the current price date stays for manual review", () => {
  const decision = decide({ invoiceDate: "2026-10-01", line: classify({ unitPrice: 26 }) });
  assert.deepEqual(decision, { retain: false, code: "date" });
});

test("a sub-penny difference is already the same penny and is not a historical keep", () => {
  const line = classify({ unitPrice: 25.994 });
  assert.equal(line.reviewStatus, "processed");
  assert.deepEqual(decide({ line, invoiceDate: "2026-07-14" }), { retain: false, code: "equal" });
});

test("a medium-confidence match stays for manual review", () => {
  const line = classify();
  line.matchConfidence = "medium";
  line.matchMethod = "specification";
  assert.deepEqual(decide({ line }), { retain: false, code: "match" });
});

test("a duplicated supplier description stays for manual review", () => {
  const products = [
    product(),
    product({
      id: "product-2",
      sku: "OTHER-1",
      currentPriceId: "price-2",
    }),
  ];
  const line = classify({ products });
  assert.equal(line.matchConfidence, "high");
  assert.deepEqual(decide({ line, products }), { retain: false, code: "description" });
});

test("a conflicting SKU or sheet size stays for manual review", () => {
  const conflictingSku = classify();
  conflictingSku.rawSupplierSku = "OTHER-SKU";
  assert.deepEqual(decide({ line: conflictingSku }), { retain: false, code: "sku" });

  const conflictingSize = decide({
    product: product({ heightMm: 1000 }),
    products: [product({ heightMm: 1000 })],
  });
  assert.deepEqual(conflictingSize, { retain: false, code: "specification" });
});

test("a missing catalogue SKU is not treated as proof of a description match", () => {
  const blank = product({ sku: null });
  const line = classify({ products: [blank] });
  assert.equal(line.matchMethod, "description");
  assert.equal(line.matchConfidence, "high");
  assert.deepEqual(decide({ line, product: blank, products: [blank] }), { retain: false, code: "sku" });
});

test("a previously confirmed mapping can retain an older price", () => {
  const mapped = product({ sku: null, description: "Catalogue wording" });
  const description = "Foamalite special sheet";
  const line = classify({
    description,
    sku: null,
    products: [mapped],
    mappings: [
      {
        supplierId: "pyramid",
        normalizedDescription: description.toLowerCase(),
        productId: mapped.id,
      },
    ],
  });
  assert.equal(line.matchMethod, "mapping");
  const decision = decide({
    line,
    product: mapped,
    products: [mapped],
    mappings: [
      {
        supplierId: "pyramid",
        normalizedDescription: description.toLowerCase(),
        productId: mapped.id,
      },
    ],
  });
  assert.equal(decision.retain, true);
});

test("a missing or invalid invoice date stays for manual review", () => {
  assert.deepEqual(decide({ invoiceDate: null }), { retain: false, code: "date" });
  assert.deepEqual(decide({ invoiceDate: "2026-02-31" }), { retain: false, code: "date" });
  assert.deepEqual(decide({ invoiceDate: "14/07/2026" }), { retain: false, code: "date" });
});

test("a missing current price stays for manual review", () => {
  const bare = product({ currentPrice: null, currentPriceId: null, currentEffectiveDate: null, currentPriceUnit: null });
  assert.deepEqual(decide({ product: bare, products: [bare], prices: [] }), { retain: false, code: "price" });
});

test("two prices on the latest effective date stay for manual review", () => {
  const decision = decide({
    prices: [price(), price({ id: "price-2", price: 24, approvedAt: "2026-10-02T00:00:00.000Z" })],
  });
  assert.deepEqual(decision, { retain: false, code: "tie" });
});

test("a duplicate invoice is rejected before a second review record", () => {
  const duplicate = findDuplicateInvoice({
    checksumSha256: "abc",
    supplierId: "pyramid",
    invoiceNumber: "SI1297918",
    invoiceDate: "2026-07-14",
    existing: [
      {
        id: "invoice-1",
        supplierId: "pyramid",
        invoiceNumber: "SI1297918",
        invoiceDate: "2026-07-14",
        checksumSha256: "other",
      },
    ],
  });
  assert.equal(duplicate?.invoiceId, "invoice-1");
});

test("statements and credit notes are not selectable for automatic promotion", () => {
  const statement = classifyDocumentRelevance("Statement of account\nBalance brought forward");
  assert.equal(statement.relevance, "irrelevant");
  assert.equal(
    promotionQueue({
      supplierMatched: true,
      supplierApproved: true,
      relevance: statement.relevance,
      status: "stored",
      documentType: "unknown",
    }).selectable,
    false
  );
  assert.equal(
    promotionQueue({
      supplierMatched: true,
      supplierApproved: true,
      relevance: classifyDocumentRelevance("Credit Memo\nSC037716").relevance,
      status: "stored",
      documentType: "unknown",
    }).selectable,
    false
  );
});

test("a failed retention write does not count the line as resolved", async () => {
  const line = classify();
  const calls: string[] = [];
  const retained = await retainHistoricalPriceLines({
    db: {
      async insertInvoice() {
        return { id: "unused" };
      },
      async deleteInvoice() {},
      async insertFile() {
        return null;
      },
      async insertLines() {
        return null;
      },
      async insertEvents() {},
      async markDocument() {},
      async listLines() {
        return [];
      },
      async retainHistoricalPrice() {
        calls.push("fail");
        throw new Error("audit insert failed");
      },
    },
    userId: "admin-1",
    supplierId: "pyramid",
    invoiceDate: "2026-07-14",
    extractionStatus: "extracted",
    draftLines: [line],
    storedLines: [
      {
        id: "line-1",
        line_number: 1,
        review_status: "price_change",
        matched_supplier_product_id: "product-1",
      },
    ],
    catalog: {
      suppliers: [],
      aliases: [],
      products: [product()],
      mappings: [],
      ignoreRules: [],
      prices: [{ productId: "product-1", ...price() }],
    },
  });

  assert.equal(retained, 0);
  assert.deepEqual(calls, ["fail"]);
});

test("a repeated retention finds the line already processed and writes nothing", async () => {
  let calls = 0;
  const catalog = {
    suppliers: [],
    aliases: [],
    products: [product()],
    mappings: [],
    ignoreRules: [],
    prices: [{ productId: "product-1", ...price() }],
  };
  const base = {
    db: {
      async insertInvoice() {
        return { id: "unused" };
      },
      async deleteInvoice() {},
      async insertFile() {
        return null;
      },
      async insertLines() {
        return null;
      },
      async insertEvents() {},
      async markDocument() {},
      async listLines() {
        return [];
      },
      async retainHistoricalPrice() {
        calls += 1;
        return { ok: true as const, alreadyResolved: false };
      },
    },
    userId: "admin-1",
    supplierId: "pyramid",
    invoiceDate: "2026-07-14",
    extractionStatus: "extracted" as const,
    draftLines: [classify()],
    catalog,
  };
  const first = await retainHistoricalPriceLines({
    ...base,
    storedLines: [
      {
        id: "line-1",
        line_number: 1,
        review_status: "price_change",
        matched_supplier_product_id: "product-1",
      },
    ],
  });
  const second = await retainHistoricalPriceLines({
    ...base,
    storedLines: [
      {
        id: "line-1",
        line_number: 1,
        review_status: "processed",
        matched_supplier_product_id: "product-1",
      },
    ],
  });

  assert.equal(first, 1);
  assert.equal(second, 0);
  assert.equal(calls, 1);
});

test("the database function retains one audited price and does not change price history or sealed runs", async () => {
  const sql = await readFile(
    new URL("../../../supabase/migrations/20261027120000_historical_price_retention.sql", import.meta.url),
    "utf8"
  );
  const decision = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.retain_historical_invoice_price"),
    sql.indexOf("REVOKE ALL ON FUNCTION public.retain_historical_invoice_price")
  );

  assert.match(sql, /supplier_invoice_events_one_historical_price_idx/);
  assert.match(decision, /SECURITY DEFINER/);
  assert.match(decision, /SET search_path = pg_catalog, public, pg_temp/);
  assert.doesNotMatch(decision, /SET search_path = public\s/);
  const ignoredAt = decision.indexOf("v_invoice.processing_status = 'ignored'");
  const retryAt = decision.indexOf("'alreadyResolved', true");
  const lineUpdateAt = decision.indexOf("UPDATE public.supplier_invoice_lines");
  const invoiceUpdateAt = decision.indexOf("UPDATE public.supplier_invoices");
  assert.ok(ignoredAt > 0);
  assert.ok(ignoredAt < retryAt);
  assert.ok(ignoredAt < lineUpdateAt);
  assert.ok(ignoredAt < invoiceUpdateAt);
  assert.match(
    decision,
    /An ignored invoice cannot receive an automatic price decision/
  );
  assert.match(decision, /alreadyResolved/);
  assert.match(decision, /'rule', 'historical_price'/);
  assert.match(decision, /The invoice date is before the current approved price effective date/);
  assert.match(decision, /UPDATE public\.supplier_invoice_lines/);
  assert.match(decision, /INSERT INTO public\.supplier_invoice_events/);
  assert.ok(decision.indexOf("UPDATE public.supplier_invoice_lines") < decision.indexOf("INSERT INTO public.supplier_invoice_events"));
  assert.equal(decision.includes("COMMIT"), false);
  assert.doesNotMatch(decision, /EXCEPTION\s+WHEN/);
  assert.equal(decision.includes("material_prices"), true);
  assert.doesNotMatch(decision, /INSERT INTO public\.material_prices|UPDATE public\.material_prices|DELETE FROM public\.material_prices/);
  assert.doesNotMatch(sql, /invoice_processing_runs|gmail_import_runs|gmail_auto_processing_enabled/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.retain_historical_invoice_price/);
  assert.doesNotMatch(sql, /TO anon|TO PUBLIC/);
});

test("human price approval and manual rejection stay on their existing paths", async () => {
  const actions = await readFile(new URL("./actions.ts", import.meta.url), "utf8");
  const reprocess = await readFile(new URL("./reprocess.ts", import.meta.url), "utf8");
  const materials = await readFile(new URL("./new-material.ts", import.meta.url), "utf8");

  assert.match(actions, /resolve_invoice_price_change/);
  assert.doesNotMatch(actions, /retain_historical_invoice_price|historicalPriceDecision/);
  assert.doesNotMatch(reprocess, /retain_historical_invoice_price|historicalPriceDecision/);
  assert.doesNotMatch(materials, /retain_historical_invoice_price|historicalPriceDecision/);
  assert.equal(
    formatPriceDecision("price_change_rejected", {
      rule: HISTORICAL_PRICE_RULE,
      invoicePrice: 26.13,
      currentPrice: 25.99,
      priceUnit: "sheet",
    }),
    "Retained the current price of £25.99 per sheet because the invoice date is before that price. The invoice price of £26.13 was not applied."
  );
  assert.match(
    formatPriceDecision("price_change_rejected", {
      invoicePrice: 26.13,
      currentPrice: 25.99,
      priceUnit: "sheet",
    }) ?? "",
    /Kept the current price/
  );
});
