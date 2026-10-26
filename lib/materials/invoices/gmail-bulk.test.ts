import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { filterInvoiceExceptions, invoiceExceptionKinds } from "@/lib/materials/invoices/exceptions";
import {
  bulkCounts,
  failedItemIds,
  initialBulkRun,
  nextBulkBatch,
  reduceBulkRun,
} from "@/lib/materials/invoices/gmail-bulk";
import type { PromotionPreviewRow, PromotionReport } from "@/lib/materials/invoices/gmail-promotion-view";
import { classifyInvoiceLine } from "@/lib/materials/invoices/match";
import { emptyLineCounts, type InvoiceListItem } from "@/lib/materials/invoices/queries";

function row(input: Partial<PromotionPreviewRow> & Pick<PromotionPreviewRow, "itemId">): PromotionPreviewRow {
  return {
    supplierName: "Test Supplier — Pyramid",
    invoiceNumber: input.itemId,
    invoiceDate: "2026-07-10",
    filename: "Sales Invoices LCAN01.pdf",
    pyramid: false,
    duplicate: null,
    selectable: true,
    ...input,
  };
}

function report(results: PromotionReport["results"]): PromotionReport {
  return {
    promoted: results.filter((result) => result.outcome === "promoted").length,
    duplicate: results.filter((result) => result.outcome === "duplicate").length,
    skipped: results.filter((result) => result.outcome === "skipped").length,
    failed: results.filter((result) => result.outcome === "failed").length,
    results,
  };
}

function outcome(
  itemId: string,
  outcomeName: PromotionReport["results"][number]["outcome"],
  invoiceDate: string | null = "2026-07-10"
): PromotionReport["results"][number] {
  return {
    itemId,
    filename: "Sales Invoices LCAN01.pdf",
    supplierName: "Test Supplier — Pyramid",
    invoiceNumber: itemId,
    invoiceDate,
    outcome: outcomeName,
    invoiceId: outcomeName === "promoted" ? `invoice-${itemId}` : null,
    extractionFailed: false,
    detail: outcomeName,
  };
}

function invoice(input: Partial<InvoiceListItem> & { lines?: Partial<InvoiceListItem["lineCounts"]> }): InvoiceListItem {
  return {
    id: input.id ?? "invoice",
    supplierName: input.supplierName === undefined ? "Pyramid" : input.supplierName,
    invoiceNumber: input.invoiceNumber ?? "SI1",
    invoiceDate: input.invoiceDate ?? "2026-07-10",
    total: null,
    extractionStatus: input.extractionStatus ?? "extracted",
    processingStatus: input.processingStatus ?? "needs_review",
    createdAt: "2026-10-26T00:00:00Z",
    lineCounts: { ...emptyLineCounts(), ...input.lines },
  };
}

describe("gmail bulk processing", () => {
  it("promotes eligible invoices in small historical batches and skips completed ones", () => {
    const rows = [
      row({ itemId: "new", invoiceDate: "2026-09-22", invoiceNumber: "SI1313370" }),
      row({ itemId: "old", invoiceDate: "2026-07-10", invoiceNumber: "SI1297356" }),
      row({
        itemId: "done",
        invoiceDate: "2026-09-11",
        duplicate: { kind: "already_promoted", invoiceId: "existing", detail: "Already promoted" },
        selectable: false,
      }),
      row({
        itemId: "duplicate",
        duplicate: { kind: "checksum", invoiceId: "other", detail: "Duplicate file" },
        selectable: false,
      }),
    ];

    assert.deepEqual(bulkCounts(rows), { eligible: 4, processed: 1, pending: 2, duplicates: 1 });
    assert.deepEqual(nextBulkBatch(rows, 1), ["old"]);
    assert.deepEqual(nextBulkBatch(rows, 10), ["old", "new"]);

    let pending = rows;
    const seen: string[] = [];

    while (nextBulkBatch(pending, 1).length > 0) {
      const batch = nextBulkBatch(pending, 1);
      seen.push(...batch);
      pending = pending.map((item) =>
        batch.includes(item.itemId)
          ? {
              ...item,
              selectable: false,
              duplicate: { kind: "already_promoted", invoiceId: item.itemId, detail: "Already promoted" },
            }
          : item
      );
    }

    assert.deepEqual(seen, ["old", "new"]);
    assert.deepEqual(nextBulkBatch(pending, 5), []);
  });

  it("keeps a failed invoice out of the next batch until it is retried", () => {
    const rows = [row({ itemId: "ok", invoiceDate: "2026-07-10" }), row({ itemId: "bad", invoiceDate: "2026-07-15" })];
    let run = reduceBulkRun(initialBulkRun(1), { type: "start" });
    const first = nextBulkBatch(rows, run.batchSize, run.skipItemIds);
    run = reduceBulkRun(run, {
      type: "batch",
      report: report([{ ...outcome("ok", "failed"), detail: "The PDF could not be read." }]),
      pending: 1,
    });

    assert.deepEqual(first, ["ok"]);
    assert.deepEqual(nextBulkBatch(rows, 5, run.skipItemIds), ["bad"]);
    assert.deepEqual(failedItemIds(run), ["ok"]);

    run = reduceBulkRun(run, { type: "retry" });
    assert.equal(run.status, "running");
    assert.deepEqual(nextBulkBatch(rows, 5, run.skipItemIds), ["ok", "bad"]);
  });

  it("pauses after the current batch and resumes without repeating it", () => {
    const rows = [row({ itemId: "a", invoiceDate: "2026-07-10" }), row({ itemId: "b", invoiceDate: "2026-08-28" })];
    let run = reduceBulkRun(initialBulkRun(1), { type: "start" });
    run = reduceBulkRun(run, { type: "pause" });
    run = reduceBulkRun(run, {
      type: "batch",
      report: report([outcome("a", "promoted", "2026-07-10")]),
      pending: 1,
    });

    assert.equal(run.status, "paused");
    assert.equal(run.promoted, 1);
    assert.equal(run.results[0]?.invoiceDate, "2026-07-10");
    assert.deepEqual(nextBulkBatch(rows, 1, ["a"]), ["b"]);

    const pausedBatch = reduceBulkRun({ ...run, status: "idle" }, {
      type: "batch",
      report: report([outcome("b", "promoted")]),
      pending: 0,
    });
    assert.equal(pausedBatch.promoted, 1);

    run = reduceBulkRun(run, { type: "resume" });
    assert.equal(run.status, "running");
    run = reduceBulkRun(run, {
      type: "batch",
      report: report([outcome("b", "duplicate", "2026-08-28")]),
      pending: 0,
    });
    assert.equal(run.status, "complete");
    assert.equal(run.duplicate, 1);
    assert.deepEqual(
      run.results.map((result) => result.itemId),
      ["a", "b"]
    );
  });

  it("records an extraction failure separately from a promotion failure", () => {
    let run = reduceBulkRun(initialBulkRun(5), { type: "start" });
    run = reduceBulkRun(run, {
      type: "batch",
      report: report([
        { ...outcome("read", "promoted"), extractionFailed: true, detail: "No lines were read." },
        outcome("missing", "skipped"),
      ]),
      pending: 0,
    });

    assert.equal(run.promoted, 1);
    assert.equal(run.extractionFailures, 1);
    assert.equal(run.skipped, 1);
    assert.equal(run.status, "complete");
    assert.deepEqual(run.skipItemIds, ["missing"]);
  });

  it("sorts the exception queue and does not treat a confident price difference as approved", () => {
    const invoices = [
      invoice({ id: "supplier", supplierName: null, invoiceDate: "2026-07-01", lines: { unmatched: 1 } }),
      invoice({ id: "material", invoiceDate: "2026-07-10", lines: { unmatched: 2 } }),
      invoice({ id: "uncertain", invoiceDate: "2026-08-01", lines: { needs_review: 1 } }),
      invoice({ id: "price", invoiceDate: "2026-08-28", lines: { price_change: 1, processed: 1 } }),
      invoice({ id: "blank", invoiceDate: "2026-09-01", extractionStatus: "failed" }),
      invoice({ id: "ready", invoiceDate: "2026-09-11", lines: { processed: 1 }, processingStatus: "processed" }),
    ];

    assert.deepEqual(invoiceExceptionKinds(invoices[0]), ["supplier", "new_material"]);
    assert.deepEqual(invoiceExceptionKinds(invoices[3]), ["price_change"]);
    assert.deepEqual(invoiceExceptionKinds(invoices[5]), ["ready"]);
    assert.deepEqual(
      filterInvoiceExceptions(invoices, { supplier: "Pyramid", from: "2026-08-01", to: "2026-08-31" }).map(
        (item) => item.id
      ),
      ["uncertain", "price"]
    );
    assert.deepEqual(
      filterInvoiceExceptions(invoices, { kind: "ready" }).map((item) => item.id),
      ["ready"]
    );

    const priceChange = classifyInvoiceLine({
      line: {
        lineNumber: 1,
        rawDescription: "5mm 3050x1560mm White P/E Foamalite Xpress Foam PVC",
        rawSupplierSku: "PQ80",
        rawQuantity: 1,
        rawUnit: "sheet",
        rawUnitPrice: 43.1,
        rawLineTotal: 43.1,
        rawTax: null,
      },
      supplierId: "pyramid",
      products: [
        {
          id: "foam",
          supplierId: "pyramid",
          sku: "PQ80",
          description: "5mm 3050x1560mm White P/E Foamalite Xpress Foam PVC",
          materialName: "Foamalite 5mm",
          purchaseUnit: "sheet",
          thicknessMm: 5,
          colour: "White",
          widthMm: 3050,
          heightMm: 1560,
          lengthMm: null,
          currentPrice: 41.75,
          currentPriceUnit: "sheet",
        },
      ],
      mappings: [],
      ignoreRules: [],
    });
    const foamAgainstDibond = classifyInvoiceLine({
      line: {
        lineNumber: 1,
        rawDescription: "3mm 3050x1560mm White P/E Foamalite Xpress Foam PVC (PQ120)",
        rawSupplierSku: "FLXP33015PE",
        rawQuantity: 7,
        rawUnit: "SHEET",
        rawUnitPrice: 25.479,
        rawLineTotal: 178.35,
        rawTax: null,
      },
      supplierId: "pyramid",
      products: [
        {
          id: "dibond",
          supplierId: "pyramid",
          sku: "PYR-DIB-3",
          description: "TEST 3mm Dibond sheet",
          materialName: "Test Material — 3mm Dibond",
          purchaseUnit: "sheet",
          thicknessMm: 3,
          colour: "White",
          widthMm: 3050,
          heightMm: 1560,
          lengthMm: null,
          currentPrice: 64.8,
          currentPriceUnit: "sheet",
        },
      ],
      mappings: [],
      ignoreRules: [],
    });

    assert.equal(priceChange.reviewStatus, "price_change");
    assert.equal(priceChange.matchMethod, "sku");
    assert.equal(foamAgainstDibond.matchedProductId, null);
    assert.equal(foamAgainstDibond.reviewStatus, "unmatched");
  });

  it("does not create materials or approve prices from the bulk workflow", async () => {
    const files = [
      "lib/materials/invoices/gmail-bulk.ts",
      "lib/materials/invoices/exceptions.ts",
      "components/materials/gmail-bulk-panel.tsx",
      "app/api/admin/materials/invoices/gmail/promote/route.ts",
    ];
    const sources = await Promise.all(
      files.map((file) => readFile(new URL(`../../../${file}`, import.meta.url), "utf8"))
    );
    const combined = sources.join("\n");

    assert.doesNotMatch(combined, /material_prices/);
    assert.doesNotMatch(combined, /create_material_from_invoice_line/);
    assert.doesNotMatch(combined, /createMaterialFromInvoiceLine/);
    assert.doesNotMatch(combined, /approve_invoice_price_change/);
    assert.match(sources[3], /promoteGmailInvoiceBatch/);
    assert.match(sources[3], /action === "bulk"/);
  });
});
