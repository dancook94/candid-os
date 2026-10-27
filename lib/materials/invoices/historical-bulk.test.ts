import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { GMAIL_ONGOING_SYNC_ENABLED } from "@/lib/gmail/config";
import type { PromotionOutcome } from "@/lib/materials/invoices/gmail-promotion-view";
import {
  HISTORICAL_SCOPE_LIMIT,
  HISTORICAL_TICK_BATCH,
  classifyHistoricalDocument,
  historicalRunRequest,
  runHistoricalSupplierScope,
  selectHistoricalSupplierScope,
  setHistoricalSupplierEnabled,
  summariseHistoricalCandidates,
  type HistoricalBulkPorts,
  type HistoricalCandidate,
  type HistoricalScopeRun,
} from "@/lib/materials/invoices/historical-bulk";
import { resolveHistoricalSupplier } from "@/lib/materials/invoices/supplier";

const suppliers = [
  { id: "antalis", name: "Antalis", normalizedName: "antalis" },
  { id: "all-print", name: "All Print Supplies", normalizedName: "all print supplies" },
];
const aliases = [
  { supplierId: "all-print", alias: "All Print Supplies Ltd", normalizedAlias: "all print supplies ltd" },
];

function candidate(overrides: Partial<HistoricalCandidate> = {}): HistoricalCandidate {
  return {
    itemId: "item-1",
    supplierId: "antalis",
    filename: "INV-1.pdf",
    documentType: "invoice",
    status: "stored",
    relevance: "supplier_invoice",
    duplicate: false,
    kind: "invoice",
    invoiceDate: "2026-07-01",
    invoiceNumber: "1",
    ...overrides,
  };
}

function outcome(itemId: string, outcomeName: PromotionOutcome["outcome"]): PromotionOutcome {
  return {
    itemId,
    filename: `${itemId}.pdf`,
    supplierName: "Antalis",
    invoiceNumber: itemId,
    invoiceDate: "2026-07-01",
    outcome: outcomeName,
    invoiceId: outcomeName === "promoted" ? `invoice-${itemId}` : null,
    extractionFailed: false,
    detail: outcomeName,
  };
}

function sealed(ids: string[], overrides: Partial<HistoricalScopeRun> = {}): HistoricalScopeRun {
  return {
    id: "run-1",
    status: "running",
    scopeItemIds: ids,
    scopeSealed: true,
    invoiceLimit: ids.length,
    ...overrides,
  };
}

test("documents are classified without treating a sales invoice footer as a remittance", () => {
  assert.equal(
    classifyHistoricalDocument({
      filename: "144418.PDF",
      text: "All Print Supplies\nTAX INVOICE\nInvoice No. 144418\nRemittance advice is printed below.",
    }).kind,
    "invoice"
  );
  assert.equal(
    classifyHistoricalDocument({
      filename: "Remittance Advice from Candid Creative Limited 14Aug2026.pdf",
      text: "Remittance advice\nInvoices paid",
    }).kind,
    "remittance"
  );
  assert.equal(
    classifyHistoricalDocument({ filename: "Official receipt.pdf", text: "Official receipt\nAmount received" }).kind,
    "receipt"
  );
  assert.equal(
    classifyHistoricalDocument({ filename: "Account statement.pdf", text: "Statement of account\nInvoice number 1" }).kind,
    "statement"
  );
  assert.equal(
    classifyHistoricalDocument({ filename: "note.pdf", text: "Please find your invoice attached." }).kind,
    "other"
  );
  assert.equal(
    classifyHistoricalDocument({
      filename: "Dunning-Letter_7279.pdf",
      text: "Invoice number 01SI-2368836-20\nTotal 100.00 GBP",
    }).kind,
    "other"
  );
});

test("supplier evidence uses a known name and leaves conflicts and bare APS unmatched", () => {
  assert.equal(
    resolveHistoricalSupplier({
      text: "Invoice No. 10",
      filename: "Antalis invoice 10.pdf",
      suppliers,
      aliases,
    }).supplierId,
    "antalis"
  );
  assert.equal(
    resolveHistoricalSupplier({
      text: "Invoice No. 10",
      sender: "accounts@allprint.co.uk",
      suppliers,
      aliases,
    }).supplierId,
    "all-print"
  );
  assert.equal(
    resolveHistoricalSupplier({
      text: "All Print Supplies Ltd\nTAX INVOICE\nInvoice No. 10",
      filename: "Antalis invoice 10.pdf",
      suppliers,
      aliases,
    }).supplierId,
    null
  );
  assert.equal(
    resolveHistoricalSupplier({
      text: "APS\nInvoice No. 10",
      rawSupplierName: "APS",
      filename: "All Print Supplies invoice.pdf",
      suppliers,
      aliases,
    }).supplierId,
    null
  );
  assert.equal(
    resolveHistoricalSupplier({
      text: "Unknown Supplies\nTAX INVOICE\nInvoice No. 10",
      rawSupplierName: "Unknown Supplies",
      filename: "Antalis invoice.pdf",
      suppliers,
      aliases,
    }).supplierId,
    null
  );
});

test("a supplier scope contains only its own stored invoices and keeps the sealed maximum", () => {
  const rows = [
    candidate({ itemId: "old", invoiceDate: "2026-07-02", invoiceNumber: "2" }),
    candidate({ itemId: "statement", kind: "statement", relevance: "irrelevant" }),
    candidate({ itemId: "other-supplier", supplierId: "all-print", invoiceDate: "2026-07-01" }),
    candidate({ itemId: "unmatched", supplierId: null }),
    candidate({ itemId: "duplicate", duplicate: true }),
    candidate({ itemId: "new", invoiceDate: "2026-07-01", invoiceNumber: "1" }),
  ];

  assert.deepEqual(selectHistoricalSupplierScope(rows, "antalis"), ["new", "old"]);
  assert.equal(historicalRunRequest(selectHistoricalSupplierScope(rows, "antalis"))?.invoiceLimit, 2);
  assert.equal(historicalRunRequest(Array.from({ length: 51 }, (_, index) => `id-${index}`)), null);
  assert.equal(HISTORICAL_SCOPE_LIMIT, 50);
  assert.equal(HISTORICAL_TICK_BATCH, 10);
  assert.equal(summariseHistoricalCandidates(rows).manual, 1);
});

test("processing enables one supplier only after the seal and disables it after completion", async () => {
  const ids = ["new", "old"];
  const calls: string[] = [];
  const ports = portsFor(ids, calls, [
    { status: "running", pending: 1, report: report([outcome("new", "promoted")]) },
    {
      status: "completed",
      pending: 0,
      report: report([outcome("old", "duplicate"), outcome("old", "promoted")]),
    },
  ]);
  const result = await runHistoricalSupplierScope({ scopeItemIds: ids, discoveryEnabled: false, ports });

  assert.deepEqual(calls, ["start", "enable", "advance", "advance", "disable"]);
  assert.equal(result.ok, true);
  assert.equal(result.promoted, 2);
  assert.equal(result.duplicate, 0);
});

test("a review result and a failed invoice do not stop the remaining sealed scope", async () => {
  const ids = ["review", "failed", "later"];
  const calls: string[] = [];
  const ports = portsFor(ids, calls, [
    { status: "running", pending: 2, report: report([outcome("review", "promoted")]) },
    { status: "running", pending: 1, report: report([outcome("failed", "failed")]) },
    { status: "completed", pending: 0, report: report([outcome("later", "promoted")]) },
  ]);
  const result = await runHistoricalSupplierScope({ scopeItemIds: ids, discoveryEnabled: false, ports });

  assert.equal(result.status, "completed");
  assert.equal(result.promoted, 2);
  assert.equal(result.failed, 1);
  assert.equal(calls.at(-1), "disable");
});

test("an interruption pauses the same run and still disables the supplier", async () => {
  const ids = ["one", "two"];
  const calls: string[] = [];
  const ports = portsFor(ids, calls, [
    { status: "running", pending: 1, report: report([outcome("one", "promoted")]) },
  ]);
  ports.advance = async () => {
    calls.push("advance");
    if (calls.filter((call) => call === "advance").length === 1) {
      return { status: "running", pending: 1, report: report([outcome("one", "promoted")]) };
    }
    throw new Error("The tick failed.");
  };
  await assert.rejects(
    runHistoricalSupplierScope({ scopeItemIds: ids, discoveryEnabled: false, ports }),
    /tick failed/
  );
  assert.deepEqual(calls.filter((call) => call === "pause" || call === "disable"), ["pause", "disable"]);
});

test("a restarted run reuses the sealed scope and does not create a second run", async () => {
  const ids = ["one", "two"];
  const calls: string[] = [];
  const ports = portsFor(ids, calls, [
    { status: "completed", pending: 0, report: report([outcome("two", "duplicate")]) },
  ]);
  ports.loadOpenRun = async () => sealed(ids, { status: "paused" });
  const result = await runHistoricalSupplierScope({ scopeItemIds: ids, discoveryEnabled: false, ports });

  assert.equal(result.ok, true);
  assert.equal(result.duplicate, 1);
  assert.equal(calls.includes("start"), false);
  assert.equal(calls[0], "resume");
  assert.equal(calls.at(-1), "disable");
});

test("discovery, another open run, and a loose seal never enable the supplier", async () => {
  const ids = ["one"];
  const blocked = portsFor(ids, [], []);
  const discovered = await runHistoricalSupplierScope({ scopeItemIds: ids, discoveryEnabled: true, ports: blocked });
  assert.equal(discovered.status, "refused");
  assert.deepEqual(blocked.calls, []);

  const other = portsFor(ids, [], []);
  other.loadOpenRun = async () => sealed(["someone-else"], { id: "other-run" });
  const conflict = await runHistoricalSupplierScope({ scopeItemIds: ids, discoveryEnabled: false, ports: other });
  assert.equal(conflict.status, "refused");
  assert.equal(other.calls.includes("enable"), false);

  const loose = portsFor(ids, [], []);
  loose.startSealedRun = async () => sealed(ids, { invoiceLimit: 50 });
  const rejected = await runHistoricalSupplierScope({ scopeItemIds: ids, discoveryEnabled: false, ports: loose });
  assert.equal(rejected.status, "refused");
  assert.equal(loose.calls.includes("enable"), false);
  assert.equal(loose.calls.includes("pause"), true);
});

test("supplier enablement updates only the requested supplier and failure cleanup disables it", async () => {
  const updates: Array<{ id: string; enabled: boolean }> = [];
  const supabase = {
    from(table: string) {
      assert.equal(table, "suppliers");
      return {
        update(values: { gmail_auto_processing_enabled: boolean }) {
          return {
            eq(_column: string, id: string) {
              updates.push({ id, enabled: values.gmail_auto_processing_enabled });
              return {
                select() {
                  return { data: [{ id, gmail_auto_processing_enabled: values.gmail_auto_processing_enabled }], error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  await setHistoricalSupplierEnabled(supabase as never, "antalis", true);
  await setHistoricalSupplierEnabled(supabase as never, "antalis", false);
  assert.deepEqual(updates, [
    { id: "antalis", enabled: true },
    { id: "antalis", enabled: false },
  ]);
});

test("the stored workflow keeps discovery off and does not write catalogue prices", async () => {
  const source = await readFile(new URL("./historical-bulk.ts", import.meta.url), "utf8");
  assert.equal(GMAIL_ONGOING_SYNC_ENABLED, false);
  assert.match(source, /discoveryEnabled: GMAIL_ONGOING_SYNC_ENABLED/);
  assert.doesNotMatch(source, /material_prices|create_material_from_invoice_line|approve_invoice_price_change|confirm_supplier_sku/);
  assert.match(source, /setSupplierEnabled\(false\)/);
});

function report(results: PromotionOutcome[]) {
  return {
    promoted: results.filter((result) => result.outcome === "promoted").length,
    duplicate: results.filter((result) => result.outcome === "duplicate").length,
    skipped: results.filter((result) => result.outcome === "skipped").length,
    failed: results.filter((result) => result.outcome === "failed").length,
    results,
  };
}

function portsFor(
  ids: string[],
  calls: string[],
  ticks: Array<{ status: string; pending?: number; report?: ReturnType<typeof report> }>
): HistoricalBulkPorts & { calls: string[] } {
  let tick = 0;
  const ports: HistoricalBulkPorts & { calls: string[] } = {
    calls,
    async loadOpenRun() {
      return null;
    },
    async startSealedRun(request) {
      calls.push("start");
      assert.equal(request.invoiceLimit, ids.length);
      assert.equal(request.batchSize, 10);
      return sealed(request.scopeItemIds);
    },
    async resume() {
      calls.push("resume");
    },
    async pause() {
      calls.push("pause");
    },
    async setSupplierEnabled(enabled) {
      calls.push(enabled ? "enable" : "disable");
    },
    async advance() {
      calls.push("advance");
      return ticks[tick++] ?? { status: "completed", pending: 0 };
    },
  };
  return ports;
}
