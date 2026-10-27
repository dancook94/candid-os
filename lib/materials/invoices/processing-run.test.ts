import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { GMAIL_ONGOING_SYNC_ENABLED } from "@/lib/gmail/config";
import type { PromotionPreviewRow, PromotionReport } from "@/lib/materials/invoices/gmail-promotion-view";
import {
  authoriseProcessingBatch,
  countsFromAttempts,
  decideProcessingTick,
  nextProcessingBatch,
  outcomesForBlockedScope,
  remainingInScope,
  resolveProcessingLimit,
  runCompletionReason,
  selectProcessingScope,
  shouldAdvanceProcessing,
  type PersistedProcessingRun,
} from "@/lib/materials/invoices/processing-run";
import { advanceInvoiceProcessing } from "@/lib/materials/invoices/processing-tick";

function row(itemId: string, invoiceDate: string, selectable = true): PromotionPreviewRow {
  return {
    itemId,
    supplierName: "Test Supplier — Pyramid",
    invoiceNumber: itemId,
    invoiceDate,
    filename: "Sales Invoices LCAN01.pdf",
    pyramid: false,
    duplicate: selectable ? null : { kind: "already_promoted", invoiceId: itemId, detail: "Already in review" },
    selectable,
  };
}

function run(input: Partial<PersistedProcessingRun> = {}): PersistedProcessingRun {
  return {
    id: "run-1",
    status: "running",
    batchSize: 2,
    invoiceLimit: 5,
    eligibleAtStart: 5,
    scopeItemIds: [],
    scopeSealed: true,
    completionReason: null,
    attemptedItemIds: [],
    promoted: 0,
    duplicate: 0,
    skipped: 0,
    failed: 0,
    extractionFailures: 0,
    lastError: null,
    leaseUntil: null,
    startedBy: "admin-1",
    heldItemIds: [],
    failedItemIds: [],
    recent: [],
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
  invoiceDate = "2026-07-10"
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

test("a paused, leased, or finished run does not take another batch", () => {
  const now = new Date("2026-10-26T14:00:00.000Z");

  assert.equal(decideProcessingTick(null, now).action, "idle");
  assert.equal(decideProcessingTick(run({ status: "completed" }), now).action, "idle");
  assert.equal(decideProcessingTick(run({ status: "paused" }), now).action, "paused");
  assert.equal(
    decideProcessingTick(run({ leaseUntil: "2026-10-26T14:01:00.000Z" }), now).action,
    "busy"
  );
  assert.equal(
    decideProcessingTick(run({ leaseUntil: "2026-10-26T13:59:00.000Z" }), now).action,
    "process"
  );
});

test("discovery in progress defers invoice processing and an idle cron can continue it", () => {
  const peek = decideProcessingTick(run(), new Date());

  assert.equal(shouldAdvanceProcessing({ status: "running" }, peek), false);
  assert.equal(shouldAdvanceProcessing({ status: "idle", needsAttention: true }, peek), false);
  assert.equal(shouldAdvanceProcessing({ status: "idle", needsAttention: false }, peek), true);
  assert.equal(shouldAdvanceProcessing({ status: "paused" }, peek), true);
  assert.equal(shouldAdvanceProcessing({ status: "idle" }, { action: "paused", run: run({ status: "paused" }) }), false);
  assert.equal(shouldAdvanceProcessing({ status: "idle" }, { action: "unavailable" }), false);
  assert.equal(GMAIL_ONGOING_SYNC_ENABLED, false);
});

test("one tick promotes the oldest batch and a later tick does not repeat it", async () => {
  const rows = [
    row("new", "2026-09-22"),
    row("old", "2026-07-10"),
    row("done", "2026-08-01", false),
  ];
  const seen: string[][] = [];
  let current = run({ batchSize: 1, invoiceLimit: 5, eligibleAtStart: 2, scopeItemIds: ["old", "new"] });
  let released = 0;

  const first = await advanceInvoiceProcessing({
    now: new Date("2026-10-26T14:00:00.000Z"),
    loadRun: async () => current,
    claim: async () => true,
    release: async () => {
      released += 1;
    },
    loadPreview: async () => ({ ok: true, rows }),
    promote: async (itemIds) => {
      seen.push(itemIds);
      return report(itemIds.map((itemId) => outcome(itemId, "promoted", itemId === "old" ? "2026-07-10" : "2026-09-22")));
    },
    record: async (_runId, processed, pending) => {
      current = {
        ...current,
        promoted: current.promoted + processed.promoted,
        attemptedItemIds: [...current.attemptedItemIds, ...processed.results.map((result) => result.itemId)],
        heldItemIds: [
          ...current.heldItemIds,
          ...processed.results.filter((result) => result.outcome === "failed").map((result) => result.itemId),
        ],
      };
      assert.equal(pending, 1);
      assert.equal(processed.results[0]?.invoiceDate, "2026-07-10");
    },
    noteError: async () => {
      throw new Error("No error was expected.");
    },
    complete: async () => {
      current = { ...current, status: "completed" };
    },
  });

  const secondRows = rows.map((item) => (item.itemId === "old" ? row("old", "2026-07-10", false) : item));
  const second = await advanceInvoiceProcessing({
    loadRun: async () => current,
    claim: async () => true,
    release: async () => {
      released += 1;
    },
    loadPreview: async () => ({ ok: true, rows: secondRows }),
    promote: async (itemIds) => {
      seen.push(itemIds);
      return report(itemIds.map((itemId) => outcome(itemId, "duplicate", "2026-09-22")));
    },
    record: async () => undefined,
    noteError: async () => undefined,
    complete: async () => {
      current = { ...current, status: "completed" };
    },
  });

  assert.equal(first.status, "running");
  assert.deepEqual(seen, [["old"], ["new"]]);
  assert.equal(second.status, "completed");
  assert.equal(released, 2);
  assert.equal(decideProcessingTick(current, new Date()).action, "idle");
});

test("a failed invoice stays out of the next tick until it is retried", async () => {
  const rows = [row("ok", "2026-07-10"), row("bad", "2026-07-15")];
  const processed = report([
    outcome("ok", "promoted"),
    { ...outcome("bad", "failed", "2026-07-15"), detail: "The PDF could not be read." },
  ]);
  const stillWaiting = remainingInScope(["ok", "bad"], processed.results.map((result) => result.itemId));
  const next = await advanceInvoiceProcessing({
    loadRun: async () =>
      run({
        batchSize: 5,
        invoiceLimit: 2,
        eligibleAtStart: 2,
        scopeItemIds: ["ok", "bad"],
        attemptedItemIds: ["bad"],
        heldItemIds: ["bad"],
        failedItemIds: ["bad"],
        failed: 1,
      }),
    claim: async () => true,
    release: async () => undefined,
    loadPreview: async () => ({ ok: true, rows }),
    promote: async (itemIds) => {
      assert.deepEqual(itemIds, ["ok"]);
      return report([outcome("ok", "duplicate")]);
    },
    record: async () => undefined,
    noteError: async () => undefined,
    complete: async () => undefined,
  });

  assert.equal(stillWaiting, 0);
  assert.equal(next.status, "completed");
  assert.deepEqual(
    countsFromAttempts([
      { itemId: "ok", outcome: "promoted", extractionFailed: false, detail: "" },
      { itemId: "bad", outcome: "failed", extractionFailed: false, detail: "" },
      { itemId: "read", outcome: "promoted", extractionFailed: true, detail: "No lines were read." },
    ]),
    { promoted: 2, duplicate: 0, skipped: 0, failed: 1, extractionFailures: 1 }
  );
});

test("a held lease or a promotion error does not start another batch", async () => {
  let promotions = 0;
  const busy = await advanceInvoiceProcessing({
    now: new Date("2026-10-26T14:00:00.000Z"),
    loadRun: async () => run({ leaseUntil: "2026-10-26T14:02:00.000Z" }),
    claim: async () => {
      throw new Error("The lease was already held.");
    },
    release: async () => undefined,
    loadPreview: async () => ({ ok: true, rows: [] }),
    promote: async () => {
      promotions += 1;
      return report([]);
    },
    record: async () => undefined,
    noteError: async () => undefined,
    complete: async () => undefined,
  });
  let noted = "";
  let released = false;
  const failed = await advanceInvoiceProcessing({
    loadRun: async () => run({ scopeItemIds: ["bad"], invoiceLimit: 1, eligibleAtStart: 1 }),
    claim: async () => true,
    release: async () => {
      released = true;
    },
    loadPreview: async () => ({ ok: true, rows: [row("bad", "2026-07-10")] }),
    promote: async () => {
      throw new Error("The stored file could not be read.");
    },
    record: async () => undefined,
    noteError: async (_runId, message) => {
      noted = message;
    },
    complete: async () => {
      throw new Error("The run should stay open after one failure.");
    },
  });
  const refused = await advanceInvoiceProcessing({
    loadRun: async () => run(),
    claim: async () => false,
    release: async () => {
      throw new Error("A refused lease must not be released by this tick.");
    },
    loadPreview: async () => ({ ok: true, rows: [row("waiting", "2026-07-10")] }),
    promote: async () => {
      promotions += 1;
      return report([]);
    },
    record: async () => undefined,
    noteError: async () => undefined,
    complete: async () => undefined,
  });

  assert.equal(busy.status, "busy");
  assert.equal(failed.status, "attention");
  assert.equal(noted, "The stored file could not be read.");
  assert.equal(released, true);
  assert.equal(refused.status, "busy");
  assert.equal(promotions, 0);
});

test("background processing reuses promotion and does not scan Gmail or approve prices", async () => {
  const files = [
    "lib/materials/invoices/processing-run.ts",
    "lib/materials/invoices/processing-store.ts",
    "lib/materials/invoices/processing-tick.ts",
    "lib/gmail/cron-http.ts",
    "supabase/migrations/20261026143000_invoice_processing_runs.sql",
  ];
  const sources = await Promise.all(files.map((file) => readFile(new URL(`../../../${file}`, import.meta.url), "utf8")));
  const combined = sources.join("\n");

  assert.match(sources[2], /promoteGmailInvoiceBatch/);
  assert.doesNotMatch(sources[2], /@\/lib\/gmail\/client|listMessages|stepGmailDiscovery/);
  assert.doesNotMatch(sources[1], /pdfjs-dist|@\/lib\/gmail\/client|promoteGmailInvoiceBatch/);
  assert.match(sources[3], /import\("@\/lib\/materials\/invoices\/processing-tick"\)/);
  assert.doesNotMatch(sources[3], /from "@\/lib\/materials\/invoices\/processing-tick"/);
  assert.doesNotMatch(sources.slice(0, 4).join("\n"), /material_prices/);
  assert.doesNotMatch(combined, /create_material_from_invoice_line|approve_invoice_price_change/);
  assert.doesNotMatch(sources[4], /INSERT INTO public\.material_prices|UPDATE public\.material_prices|ALTER TABLE public\.materials|gmail_sync_checkpoints/);
  assert.match(sources[4], /claim_invoice_processing_run/);
  assert.match(sources[3], /shouldAdvanceProcessing/);
});

test("processing grants admit only approved administrators and the service role", async () => {
  const original = await readFile(
    new URL("../../../supabase/migrations/20261026143000_invoice_processing_runs.sql", import.meta.url),
    "utf8"
  );
  const grants = await readFile(
    new URL("../../../supabase/migrations/20261026160000_invoice_processing_grants.sql", import.meta.url),
    "utf8"
  );
  const panel = await readFile(
    new URL("../../../components/materials/gmail-bulk-panel.tsx", import.meta.url),
    "utf8"
  );
  const adminClient = await readFile(new URL("../../../lib/supabase/admin.ts", import.meta.url), "utf8");

  assert.doesNotMatch(original, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.invoice_processing_runs/);
  assert.match(original, /SECURITY DEFINER/);
  assert.match(original, /SET search_path = public/);
  assert.match(original, /auth\.role\(\) IS DISTINCT FROM 'service_role' AND NOT public\.is_approved_candid_admin\(\)/);

  assert.match(grants, /REVOKE ALL ON TABLE public\.invoice_processing_runs FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(grants, /REVOKE ALL ON TABLE public\.invoice_processing_attempts FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(grants, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.invoice_processing_runs TO authenticated/);
  assert.match(grants, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.invoice_processing_attempts TO authenticated/);
  assert.match(grants, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.invoice_processing_runs TO service_role/);
  assert.match(grants, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.invoice_processing_attempts TO service_role/);
  assert.match(grants, /FOR ALL\s+TO authenticated\s+USING \(public\.is_approved_candid_admin\(\)\)/);
  assert.match(grants, /REVOKE ALL ON FUNCTION public\.claim_invoice_processing_run\(uuid, integer\) FROM PUBLIC, anon/);
  assert.match(grants, /GRANT EXECUTE ON FUNCTION public\.claim_invoice_processing_run\(uuid, integer\) TO authenticated, service_role/);
  assert.doesNotMatch(grants, /GRANT .* TO anon|GRANT .* TO PUBLIC|TO anon,|TO PUBLIC/);
  assert.doesNotMatch(grants, /USING \(true\)|WITH CHECK \(true\)/);
  assert.doesNotMatch(grants, /GRANT DELETE ON TABLE public\.invoice_processing_runs|DELETE ON TABLE public\.invoice_processing_runs TO/);
  assert.doesNotMatch(grants, /CREATE SEQUENCE|GRANT .* SEQUENCE/);
  assert.doesNotMatch(grants, /material_prices|ALTER TABLE public\.materials|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(grants, /CREATE OR REPLACE FUNCTION public\.claim_invoice_processing_run/);
  assert.doesNotMatch(panel, /createAdminClient|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(adminClient, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(adminClient, /"use client"/);
});

test("a numeric maximum defaults safely and all eligible is explicit", () => {
  assert.equal(resolveProcessingLimit({ requested: 999, eligibleCount: 399 }), 5);
  assert.equal(resolveProcessingLimit({ requested: "all", eligibleCount: 399 }), 399);
  assert.equal(resolveProcessingLimit({ requested: 1, eligibleCount: 399 }), 1);
  assert.deepEqual(
    selectProcessingScope(
      [row("later", "2026-09-01"), row("blocked", "2026-01-01", false), row("earlier", "2026-05-01"), row("middle", "2026-07-01")],
      2
    ),
    ["earlier", "middle"]
  );
  assert.deepEqual(
    authoriseProcessingBatch({
      scopeItemIds: ["a", "b", "c", "d", "e"],
      attemptedItemIds: ["a", "b", "c", "d"],
      requestedItemIds: ["e", "f", "a"],
      batchSize: 10,
    }),
    ["e"]
  );
  assert.equal(runCompletionReason({ invoiceLimit: 5, eligibleAtStart: 20 }), "limit_reached");
  assert.equal(runCompletionReason({ invoiceLimit: 5, eligibleAtStart: 3 }), "queue_exhausted");
});

test("batch size 1 and maximum 5 stop after five scheduled ticks", async () => {
  const scope = ["a", "b", "c", "d", "e"];
  const rows = [row("f", "2026-01-01"), ...scope.map((itemId, index) => row(itemId, `2026-0${index + 5}-01`))];
  let current = run({ batchSize: 1, invoiceLimit: 5, eligibleAtStart: 6, scopeItemIds: scope });
  const seen: string[] = [];

  for (let tick = 0; tick < 5; tick += 1) {
    const result = await advanceInvoiceProcessing({
      loadRun: async () => current,
      claim: async () => current.status === "running",
      release: async () => undefined,
      loadPreview: async () => ({ ok: true, rows }),
      promote: async (itemIds) => {
        seen.push(...itemIds);
        return report(itemIds.map((itemId) => outcome(itemId, "promoted")));
      },
      record: async (_runId, processed) => {
        current = {
          ...current,
          attemptedItemIds: [...current.attemptedItemIds, ...processed.results.map((item) => item.itemId)],
          promoted: current.promoted + processed.promoted,
        };
      },
      noteError: async () => {
        throw new Error("No error was expected.");
      },
      complete: async (_runId, reason) => {
        current = { ...current, status: "completed", completionReason: reason };
      },
    });
    assert.equal(result.status, tick === 4 ? "completed" : "running");
    assert.equal(result.pending, 4 - tick);
  }

  const idle = await advanceInvoiceProcessing({
    loadRun: async () => current,
    claim: async () => {
      throw new Error("A finished run must not be claimed.");
    },
    release: async () => undefined,
    loadPreview: async () => ({ ok: true, rows }),
    promote: async () => report([]),
    record: async () => undefined,
    noteError: async () => undefined,
    complete: async () => undefined,
  });

  assert.deepEqual(seen, scope);
  assert.equal(current.completionReason, "limit_reached");
  assert.equal(idle.status, "idle");
});

test("duplicates and failures consume the allowance and pause resume retry stay inside it", async () => {
  const scope = ["a", "b", "c", "d", "e"];
  const rows = [...scope.map((itemId, index) => row(itemId, `2026-0${index + 5}-01`)), row("f", "2026-02-01")];
  let current = run({ batchSize: 5, invoiceLimit: 5, eligibleAtStart: 6, scopeItemIds: scope, status: "paused" });
  let promoted: string[] = [];

  const paused = await advanceInvoiceProcessing({
    loadRun: async () => current,
    claim: async () => {
      throw new Error("A paused run must not be claimed.");
    },
    release: async () => undefined,
    loadPreview: async () => ({ ok: true, rows }),
    promote: async () => report([]),
    record: async () => undefined,
    noteError: async () => undefined,
    complete: async () => undefined,
  });
  current = { ...current, status: "running" };
  const resumed = await advanceInvoiceProcessing({
    loadRun: async () => current,
    claim: async () => true,
    release: async () => undefined,
    loadPreview: async () => ({ ok: true, rows }),
    promote: async (itemIds) => {
      promoted.push(...itemIds);
      return report(itemIds.map((itemId) => outcome(itemId, itemId === "a" ? "failed" : "duplicate")));
    },
    record: async (_runId, processed) => {
      current = {
        ...current,
        attemptedItemIds: processed.results.map((item) => item.itemId),
        heldItemIds: processed.results.filter((item) => item.outcome === "failed").map((item) => item.itemId),
        failedItemIds: processed.results.filter((item) => item.outcome === "failed").map((item) => item.itemId),
      };
    },
    noteError: async () => undefined,
    complete: async (_runId, reason) => {
      current = { ...current, status: "completed", completionReason: reason };
    },
  });

  assert.equal(paused.status, "paused");
  assert.equal(resumed.status, "completed");
  assert.deepEqual(promoted, scope);
  assert.equal(current.completionReason, "limit_reached");
  assert.equal(remainingInScope(scope, current.attemptedItemIds), 0);

  current = {
    ...current,
    status: "running",
    completionReason: null,
    attemptedItemIds: current.attemptedItemIds.filter((itemId) => itemId !== "a"),
    heldItemIds: [],
    failedItemIds: [],
  };
  const retried = await advanceInvoiceProcessing({
    loadRun: async () => current,
    claim: async () => true,
    release: async () => undefined,
    loadPreview: async () => ({ ok: true, rows }),
    promote: async (itemIds) => {
      assert.deepEqual(itemIds, ["a"]);
      return report([outcome("a", "promoted")]);
    },
    record: async () => undefined,
    noteError: async () => undefined,
    complete: async (_runId, reason) => {
      current = { ...current, status: "completed", completionReason: reason };
    },
  });

  assert.equal(retried.status, "completed");
  assert.equal(promoted.includes("f"), false);
});

test("a shorter queue finishes because it was exhausted", async () => {
  const rows = [row("only", "2026-05-01"), row("second", "2026-06-01"), row("third", "2026-07-01")];
  let current = run({
    batchSize: 1,
    invoiceLimit: 5,
    eligibleAtStart: 3,
    scopeItemIds: ["only", "second", "third"],
  });
  const seen: string[] = [];

  while (current.status === "running") {
    await advanceInvoiceProcessing({
      loadRun: async () => current,
      claim: async () => true,
      release: async () => undefined,
      loadPreview: async () => ({ ok: true, rows }),
      promote: async (itemIds) => {
        seen.push(...itemIds);
        return report(itemIds.map((itemId) => outcome(itemId, "promoted")));
      },
      record: async (_runId, processed) => {
        current = {
          ...current,
          attemptedItemIds: [...current.attemptedItemIds, ...processed.results.map((item) => item.itemId)],
        };
      },
      noteError: async () => undefined,
      complete: async (_runId, reason) => {
        current = { ...current, status: "completed", completionReason: reason };
      },
    });
  }

  assert.deepEqual(seen, ["only", "second", "third"]);
  assert.equal(current.completionReason, "queue_exhausted");
});

test("two workers cannot both take a batch from the same run", async () => {
  let locked = false;
  let current = run({ batchSize: 1, invoiceLimit: 5, eligibleAtStart: 6, scopeItemIds: ["a", "b", "c", "d", "e"] });
  const rows = [row("f", "2026-01-01"), row("a", "2026-05-01"), row("b", "2026-06-01")];
  const seen: string[] = [];
  const tick = () =>
    advanceInvoiceProcessing({
      loadRun: async () => current,
      claim: async () => {
        if (locked) {
          return false;
        }
        locked = true;
        return true;
      },
      release: async () => {
        locked = false;
      },
      loadPreview: async () => ({ ok: true, rows }),
      promote: async (itemIds) => {
        seen.push(...itemIds);
        return report(itemIds.map((itemId) => outcome(itemId, "promoted")));
      },
      record: async (_runId, processed) => {
        current = {
          ...current,
          attemptedItemIds: [...current.attemptedItemIds, ...processed.results.map((item) => item.itemId)],
        };
      },
      noteError: async () => undefined,
      complete: async () => undefined,
    });
  const wave = await Promise.all([tick(), tick()]);

  assert.equal(wave.filter((result) => result.status === "busy").length, 1);
  assert.deepEqual(seen, ["a"]);
});

test("the processing limit is sealed in the database and does not approve prices", async () => {
  const migration = await readFile(
    new URL("../../../supabase/migrations/20261026180000_invoice_processing_limits.sql", import.meta.url),
    "utf8"
  );
  const store = await readFile(new URL("./processing-store.ts", import.meta.url), "utf8");
  const tick = await readFile(new URL("./processing-tick.ts", import.meta.url), "utf8");
  const updates = store.match(/\.update\(\{[\s\S]*?\}\)/g) ?? [];

  assert.match(migration, /invoice_processing_scope/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /The invoice processing maximum cannot be changed/);
  assert.match(migration, /This invoice is outside the processing run/);
  assert.match(migration, /GRANT SELECT, INSERT ON TABLE public\.invoice_processing_scope TO authenticated, service_role/);
  assert.doesNotMatch(migration, /GRANT .* TO anon|GRANT .* TO PUBLIC|material_prices|ALTER TABLE public\.materials/);
  assert.doesNotMatch(migration, /GRANT UPDATE ON TABLE public\.invoice_processing_scope|GRANT DELETE ON TABLE public\.invoice_processing_scope/);
  assert.ok(updates.length > 0);
  for (const update of updates) {
    assert.doesNotMatch(update, /invoice_limit/);
  }
  assert.match(store, /invoice_limit: input\.invoiceLimit/);
  assert.doesNotMatch(tick, /material_prices|create_material_from_invoice_line|approve_invoice_price_change/);
  assert.match(tick, /runCompletionReason/);
});

test("a sealed maximum does not replace an excluded document or reopen a completed run", () => {
  const reminder = {
    ...row("reminder", "2026-04-01"),
    queue: "excluded" as const,
    queueReason: "Excluded as irrelevant: overdue-payment reminder.",
    selectable: false,
    duplicate: null,
  };
  const manual = {
    ...row("unknown", "2026-04-02"),
    queue: "manual" as const,
    selectable: false,
    duplicate: null,
  };
  const first = row("pyramid", "2026-05-01");
  const later = row("all-print", "2026-06-01");
  assert.deepEqual(selectProcessingScope([reminder, manual, first, later], 1), ["pyramid"]);

  const sealed = run({
    invoiceLimit: 1,
    eligibleAtStart: 2,
    scopeItemIds: ["reminder"],
    scopeSealed: true,
    attemptedItemIds: [],
  });
  const blocked = outcomesForBlockedScope(sealed, [reminder, first]);
  assert.equal(blocked.skipped, 1);
  assert.match(blocked.results[0]?.detail ?? "", /Excluded as irrelevant/);
  assert.deepEqual(nextProcessingBatch({ ...sealed, attemptedItemIds: ["reminder"] }, [reminder, later]), []);
  assert.equal(remainingInScope(["reminder"], ["reminder"]), 0);

  const completed = run({
    status: "completed",
    completionReason: "limit_reached",
    invoiceLimit: 1,
    scopeItemIds: ["reminder"],
    attemptedItemIds: ["reminder"],
  });
  assert.equal(decideProcessingTick(completed, new Date("2026-10-26T12:00:00Z")).action, "idle");
  assert.deepEqual(selectProcessingScope([reminder, later], 1), ["all-print"]);
});
