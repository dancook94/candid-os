import {
  GMAIL_PROMOTION_BATCH_LIMIT,
  type PromotionOutcome,
  type PromotionPreviewRow,
  type PromotionReport,
} from "@/lib/materials/invoices/gmail-promotion-view";

export type BulkRunStatus = "idle" | "running" | "paused" | "complete";

export type BulkRun = {
  status: BulkRunStatus;
  batchSize: number;
  promoted: number;
  duplicate: number;
  skipped: number;
  failed: number;
  extractionFailures: number;
  pending: number | null;
  skipItemIds: string[];
  results: PromotionOutcome[];
};

export type BulkEvent =
  | { type: "start" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "retry" }
  | { type: "batch"; report: PromotionReport; pending: number };

export function clampBulkBatchSize(value: number) {
  if (!Number.isFinite(value)) {
    return 5;
  }

  return Math.min(GMAIL_PROMOTION_BATCH_LIMIT, Math.max(1, Math.floor(value)));
}

export function bulkCounts(rows: readonly PromotionPreviewRow[]) {
  return {
    eligible: rows.length,
    processed: rows.filter((row) => row.duplicate?.kind === "already_promoted").length,
    pending: rows.filter((row) => row.selectable).length,
    duplicates: rows.filter((row) => row.duplicate != null && row.duplicate.kind !== "already_promoted")
      .length,
  };
}

export function nextBulkBatch(
  rows: readonly PromotionPreviewRow[],
  batchSize: number,
  skipItemIds: readonly string[] = []
) {
  const skip = new Set(skipItemIds);
  const size = clampBulkBatchSize(batchSize);

  return [...rows]
    .filter((row) => row.selectable && !skip.has(row.itemId))
    .sort(compareHistoricalInvoices)
    .slice(0, size)
    .map((row) => row.itemId);
}

export function emptyBulkReport(): PromotionReport {
  return { promoted: 0, duplicate: 0, skipped: 0, failed: 0, results: [] };
}

export function initialBulkRun(batchSize = 5): BulkRun {
  return {
    status: "idle",
    batchSize: clampBulkBatchSize(batchSize),
    promoted: 0,
    duplicate: 0,
    skipped: 0,
    failed: 0,
    extractionFailures: 0,
    pending: null,
    skipItemIds: [],
    results: [],
  };
}

export function reduceBulkRun(run: BulkRun, event: BulkEvent): BulkRun {
  if (event.type === "start") {
    return { ...initialBulkRun(run.batchSize), status: "running" };
  }

  if (event.type === "pause") {
    return run.status === "running" ? { ...run, status: "paused" } : run;
  }

  if (event.type === "resume") {
    if (run.status !== "paused") {
      return run;
    }

    return { ...run, status: run.pending === 0 ? "complete" : "running" };
  }

  if (event.type === "retry") {
    const failedIds = new Set(
      run.results.filter((result) => result.outcome === "failed").map((result) => result.itemId)
    );

    return {
      ...run,
      status: "running",
      skipItemIds: run.skipItemIds.filter((itemId) => !failedIds.has(itemId)),
    };
  }

  if (run.status !== "running" && run.status !== "paused") {
    return run;
  }

  const results = mergeResults(run.results, event.report.results);
  const heldIds = results
    .filter((result) => result.outcome === "failed" || result.outcome === "skipped")
    .map((result) => result.itemId);

  return summariseRun({
    ...run,
    status: event.pending === 0 ? "complete" : run.status,
    pending: event.pending,
    skipItemIds: [...new Set([...run.skipItemIds, ...heldIds])],
    results,
  });
}

export function failedItemIds(run: BulkRun) {
  return run.results.filter((result) => result.outcome === "failed").map((result) => result.itemId);
}

function summariseRun(run: BulkRun): BulkRun {
  return {
    ...run,
    promoted: run.results.filter((result) => result.outcome === "promoted").length,
    duplicate: run.results.filter((result) => result.outcome === "duplicate").length,
    skipped: run.results.filter((result) => result.outcome === "skipped").length,
    failed: run.results.filter((result) => result.outcome === "failed").length,
    extractionFailures: run.results.filter((result) => result.extractionFailed).length,
  };
}

function mergeResults(existing: readonly PromotionOutcome[], incoming: readonly PromotionOutcome[]) {
  const incomingIds = new Set(incoming.map((result) => result.itemId));
  return [...existing.filter((result) => !incomingIds.has(result.itemId)), ...incoming];
}

function compareHistoricalInvoices(left: PromotionPreviewRow, right: PromotionPreviewRow) {
  const date = (left.invoiceDate ?? "9999-99-99").localeCompare(right.invoiceDate ?? "9999-99-99");

  if (date !== 0) {
    return date;
  }

  return (left.invoiceNumber ?? left.filename).localeCompare(right.invoiceNumber ?? right.filename);
}
