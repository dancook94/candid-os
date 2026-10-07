import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { selectCurrentApprovedPrice, type ApprovedPriceRecord } from "@/lib/materials/pricing";
import { classifyInvoiceLine } from "@/lib/materials/invoices/match";
import { moneyMatches } from "@/lib/materials/invoices/money";
import type { InvoiceMatchProduct } from "@/lib/materials/invoices/model";
import {
  formatPriceDecision,
  priceApprovalConsequence,
  reprocessBlockReason,
} from "@/lib/materials/invoices/price-change";

const pyramid: InvoiceMatchProduct = {
  id: "foam-pyramid",
  supplierId: "pyramid",
  sku: "PQ80",
  description: "5mm Foamalite sheet",
  materialName: "Foamalite 5mm PVC",
  purchaseUnit: "sheet",
  thicknessMm: 5,
  colour: "White",
  widthMm: 3050,
  heightMm: 1560,
  lengthMm: null,
  currentPrice: 41.75,
  currentPriceUnit: "sheet",
  currentPriceId: "price-current",
  currentEffectiveDate: "2026-09-28",
};

const antalis: InvoiceMatchProduct = {
  ...pyramid,
  id: "foam-antalis",
  supplierId: "antalis",
  sku: "ANT-1",
  currentPrice: 10,
  currentPriceId: "price-antalis",
};

function line(overrides: Partial<{
  description: string;
  sku: string | null;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  tax: number | null;
}> = {}) {
  const unitPrice = overrides.unitPrice ?? 41.75;
  return {
    lineNumber: 1,
    rawDescription: overrides.description ?? "5mm Foamalite sheet",
    rawSupplierSku: overrides.sku === undefined ? "PQ80" : overrides.sku,
    rawQuantity: 1,
    rawUnit: overrides.unit ?? "sheet",
    rawUnitPrice: unitPrice,
    rawLineTotal: overrides.lineTotal ?? unitPrice,
    rawTax: overrides.tax ?? null,
  };
}

function classify(input: {
  unitPrice?: number;
  unit?: string;
  lineTotal?: number;
  tax?: number | null;
  reviewedPrice?: number;
  products?: InvoiceMatchProduct[];
}) {
  return classifyInvoiceLine({
    line: line({
      unit: input.unit,
      unitPrice: input.unitPrice,
      lineTotal: input.lineTotal,
      tax: input.tax,
    }),
    supplierId: "pyramid",
    products: input.products ?? [pyramid, antalis],
    mappings: [],
    ignoreRules: [],
    unitPrice: input.reviewedPrice,
    lineTotal: input.reviewedPrice ?? input.lineTotal,
  });
}

function price(overrides: Partial<ApprovedPriceRecord>): ApprovedPriceRecord {
  return {
    id: "price",
    price: 41.75,
    priceUnit: "sheet",
    effectiveDate: "2026-09-28",
    approvedAt: "2026-09-28T12:00:00.000Z",
    createdAt: "2026-09-28T12:00:00.000Z",
    ...overrides,
  };
}

describe("invoice price changes", () => {
  it("processes a same-price high-confidence match and flags increases and decreases", () => {
    const same = classify({ unitPrice: 41.75, tax: 20 });
    const increase = classify({ unitPrice: 43.1, lineTotal: 43.1 });
    const decrease = classify({ unitPrice: 39.5, lineTotal: 39.5 });

    assert.equal(same.reviewStatus, "processed");
    assert.equal(same.comparison?.invoicePrice, 41.75);
    assert.equal(increase.reviewStatus, "price_change");
    assert.equal(increase.comparison?.difference, 1.35);
    assert.equal(increase.comparison?.percent, 3.23);
    assert.equal(decrease.reviewStatus, "price_change");
    assert.equal(decrease.comparison?.difference, -2.25);
    assert.ok((decrease.comparison?.percent ?? 0) < 0);
    assert.equal(same.matchedProductId, "foam-pyramid");
    assert.notEqual(same.matchedProductId, "foam-antalis");
  });

  it("uses a reviewed unit price and refuses an incompatible unit", () => {
    const corrected = classify({
      unitPrice: 41.75,
      reviewedPrice: 43.1,
    });
    const pack = classify({ unit: "pack", unitPrice: 43.1, lineTotal: 43.1 });
    const metre = classify({ unit: "m", unitPrice: 43.1, lineTotal: 43.1 });

    assert.equal(corrected.reviewStatus, "price_change");
    assert.equal(corrected.comparison?.invoicePrice, 43.1);
    assert.equal(pack.reviewStatus, "needs_review");
    assert.equal(pack.comparison, null);
    assert.match(pack.note ?? "", /unit/);
    assert.equal(metre.reviewStatus, "needs_review");
    assert.equal(metre.comparison, null);
    assert.equal(moneyMatches(41.749, 41.751), true);
  });

  it("keeps a newer effective date current and lets a later same-day approval win", () => {
    const current = selectCurrentApprovedPrice([
      price({ id: "old-invoice", price: 42, effectiveDate: "2026-06-01" }),
      price({ id: "current", price: 45, effectiveDate: "2026-09-28" }),
    ]);
    const sameDay = selectCurrentApprovedPrice([
      price({
        id: "morning",
        price: 41.75,
        effectiveDate: "2026-09-28",
        approvedAt: "2026-09-28T09:00:00.000Z",
        createdAt: "2026-09-28T09:00:00.000Z",
      }),
      price({
        id: "afternoon",
        price: 43.1,
        effectiveDate: "2026-09-28",
        approvedAt: "2026-09-28T15:00:00.000Z",
        createdAt: "2026-09-28T15:00:00.000Z",
      }),
    ]);

    assert.equal(current?.id, "current");
    assert.equal(current?.price, 45);
    assert.equal(sameDay?.id, "afternoon");
    assert.equal(sameDay?.price, 43.1);
  });

  it("explains whether approval becomes current or historical", () => {
    const older = priceApprovalConsequence({
      invoiceDate: "2026-06-01",
      currentEffectiveDate: "2026-09-28",
      invoicePrice: 42,
      currentPrice: 45,
    });
    const newer = priceApprovalConsequence({
      invoiceDate: "2026-10-02",
      currentEffectiveDate: "2026-09-28",
      invoicePrice: 43.1,
      currentPrice: 41.75,
    });
    const sameDay = priceApprovalConsequence({
      invoiceDate: "2026-09-28",
      currentEffectiveDate: "2026-09-28",
      invoicePrice: 43.1,
      currentPrice: 41.75,
    });

    assert.equal(older.effect, "history");
    assert.match(older.message, /older than the current approved price/);
    assert.match(older.message, /£42\.00/);
    assert.match(older.message, /remain £45\.00/);
    assert.equal(newer.effect, "current");
    assert.match(newer.message, /make it the current price/);
    assert.equal(sameDay.effect, "same_date");
    assert.match(sameDay.message, /later approval/);
    assert.match(
      formatPriceDecision("price_change_rejected", {
        invoicePrice: 42,
        currentPrice: 45,
        priceUnit: "sheet",
      }) ?? "",
      /not applied/
    );
    assert.match(
      formatPriceDecision("price_change_approved", {
        invoicePrice: 42,
        previousPrice: 45,
        priceUnit: "sheet",
        becameCurrent: false,
      }) ?? "",
      /historical evidence/
    );
    assert.match(formatPriceDecision("price_change_queried", {}) ?? "", /No price was created/);
  });

  it("blocks destructive reprocessing after permanent invoice decisions", () => {
    const lineId = "line-1";
    const base = {
      lineIds: [lineId],
      invoicePriceLineIds: [] as string[],
      mappingLineIds: [] as string[],
      ignoreRuleLineIds: [] as string[],
      events: [] as { lineId: string | null; action: string }[],
    };

    assert.match(
      reprocessBlockReason({ ...base, invoicePriceLineIds: [lineId] }) ?? "",
      /approved material price/
    );
    assert.match(
      reprocessBlockReason({
        ...base,
        events: [{ lineId, action: "price_change_approved" }],
      }) ?? "",
      /permanent decision/
    );
    assert.match(
      reprocessBlockReason({
        ...base,
        events: [{ lineId, action: "material_created" }],
      }) ?? "",
      /permanent decision/
    );
    assert.match(
      reprocessBlockReason({ ...base, mappingLineIds: [lineId] }) ?? "",
      /description mapping/
    );
    assert.equal(
      reprocessBlockReason({
        ...base,
        events: [
          { lineId, action: "price_change_detected" },
          { lineId, action: "price_change_queried" },
          { lineId, action: "line_corrected" },
        ],
      }),
      null
    );
    assert.equal(
      reprocessBlockReason({
        ...base,
        invoicePriceLineIds: ["other-invoice-line"],
        events: [{ lineId: "other-invoice-line", action: "opening_price_created" }],
      }),
      null
    );
  });

  it("appends one price in a locked function and blocks reprocess before deleting lines", async () => {
    const sql = await readFile(
      new URL(
        "../../../supabase/migrations/20261007190000_invoice_price_change.sql",
        import.meta.url
      ),
      "utf8"
    );
    const fn = sql.slice(
      sql.indexOf("CREATE OR REPLACE FUNCTION public.resolve_invoice_price_change"),
      sql.indexOf("REVOKE ALL ON FUNCTION public.resolve_invoice_price_change")
    );
    const reprocess = await readFile(
      new URL("./reprocess.ts", import.meta.url),
      "utf8"
    );
    const guard = await readFile(
      new URL("./reprocess-guard.ts", import.meta.url),
      "utf8"
    );

    assert.equal(fn.match(/INSERT INTO public\.material_prices/g)?.length, 1);
    assert.match(fn, /v_invoice\.invoice_date/);
    assert.match(fn, /'supplier_invoice'/);
    assert.match(fn, /p_invoice_line_id::text/);
    assert.match(fn, /COALESCE\(v_line\.reviewed_unit_price, v_line\.raw_unit_price\)/);
    assert.match(fn, /FOR UPDATE/);
    assert.match(fn, /price_change_approved/);
    assert.match(fn, /price_change_rejected/);
    assert.match(fn, /price_change_queried/);
    assert.match(fn, /alreadyResolved/);
    assert.match(fn, /unique_violation/);
    assert.match(fn, /The current approved price changed/);
    assert.match(fn, /The matched supplier product changed/);
    assert.match(fn, /does not belong to this invoice supplier/);
    assert.match(fn, /does not match the material purchase unit/);
    assert.match(fn, /already created a price/);
    assert.doesNotMatch(fn, /raw_tax|v_invoice\.vat|v_line\.raw_line_total/);
    assert.doesNotMatch(fn, /UPDATE public\.material_prices/);
    assert.doesNotMatch(fn, /DELETE FROM public\.material_prices/);
    assert.doesNotMatch(fn, /UPDATE public\.material_supplier_products/);
    assert.doesNotMatch(fn, /set_material_supplier_product_preferred/);
    assert.doesNotMatch(fn, /\bCOMMIT\b/);
    assert.match(sql, /price_change_detected/);
    assert.match(sql, /approved material price and cannot be replaced/);
    assert.match(sql, /description mapping and cannot be replaced/);
    assert.match(sql, /permanent decision and cannot be replaced/);
    assert.doesNotMatch(sql, /dc9a1487-5751-4437-943d-6b2111f50a33/);
    assert.doesNotMatch(sql, /0776d3af-8bb3-4408-ac00-41eecd23f62c/);
    assert.ok(reprocess.indexOf("findInvoiceReprocessBlock") < reprocess.indexOf(".delete()"));
    assert.doesNotMatch(guard, /\.delete\(|\.insert\(|\.update\(|\.upsert\(/);
    assert.match(guard, /\.from\("material_prices"\)/);
    assert.match(guard, /\.select\(/);
  });
});
