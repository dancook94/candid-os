import { nextBulkBatch } from "@/lib/materials/invoices/gmail-bulk";
import type { PromotionPreviewRow, PromotionOutcome, PromotionReport } from "@/lib/materials/invoices/gmail-promotion-view";

export const INVOICE_PROCESSING_LEASE_SECONDS = 120;

export const INVOICE_PROCESSING_MIGRATION_MESSAGE =
  "Apply the invoice processing migrations before background processing can continue after this page is closed.";

export const INVOICE_PROCESSING_LIMIT_CHOICES = [1, 5, 10, 25, 50] as const;

export const INVOICE_PROCESSING_DEFAULT_LIMIT = 5;

export const INVOICE_PROCESSING_DEFAULT_BATCH_SIZE = 1;

export const INVOICE_PROCESSING_ALL_ELIGIBLE = "all";

export type InvoiceProcessingCompletionReason = "limit_reached" | "queue_exhausted";

export type PersistedProcessingStatus = "running" | "paused" | "completed";

export type ProcessingAttempt = {
  itemId: string;
  outcome: PromotionReport["results"][number]["outcome"];
  extractionFailed: boolean;
  detail: string;
};

export type PersistedProcessingRun = {
  id: string;
  status: PersistedProcessingStatus;
  batchSize: number;
  invoiceLimit: number;
  eligibleAtStart: number;
  scopeItemIds: string[];
  scopeSealed: boolean;
  completionReason: InvoiceProcessingCompletionReason | null;
  promoted: number;
  duplicate: number;
  skipped: number;
  failed: number;
  extractionFailures: number;
  lastError: string | null;
  leaseUntil: string | null;
  startedBy: string | null;
  heldItemIds: string[];
  failedItemIds: string[];
  attemptedItemIds: string[];
  recent: ProcessingAttempt[];
};

export type ProcessingPeek =
  | { action: "idle" }
  | { action: "unavailable" }
  | { action: "paused"; run: PersistedProcessingRun }
  | { action: "busy"; run: PersistedProcessingRun }
  | { action: "process"; run: PersistedProcessingRun };

export function resolveProcessingLimit(input: { requested: unknown; eligibleCount: number }) {
  if (input.requested === INVOICE_PROCESSING_ALL_ELIGIBLE) {
    return Math.max(0, Math.floor(input.eligibleCount));
  }

  const value = typeof input.requested === "number" ? input.requested : Number(input.requested);

  if ((INVOICE_PROCESSING_LIMIT_CHOICES as readonly number[]).includes(value)) {
    return value;
  }

  return INVOICE_PROCESSING_DEFAULT_LIMIT;
}

export function selectProcessingScope(rows: readonly PromotionPreviewRow[], limit: number) {
  return [...rows]
    .filter((row) => row.selectable)
    .sort(compareHistoricalInvoices)
    .slice(0, Math.max(0, Math.floor(limit)))
    .map((row) => row.itemId);
}

export function runCompletionReason(run: Pick<PersistedProcessingRun, "invoiceLimit" | "eligibleAtStart">): InvoiceProcessingCompletionReason {
  return run.eligibleAtStart > run.invoiceLimit ? "limit_reached" : "queue_exhausted";
}

export function processingProgress(run: Pick<PersistedProcessingRun, "scopeItemIds" | "attemptedItemIds" | "invoiceLimit">) {
  const processed = run.attemptedItemIds.length;

  return {
    maximum: run.invoiceLimit,
    authorised: run.scopeItemIds.length,
    processed,
    remaining: Math.max(run.scopeItemIds.length - processed, 0),
  };
}

export function completionReasonText(run: Pick<PersistedProcessingRun, "completionReason" | "invoiceLimit" | "scopeItemIds">) {
  if (run.completionReason === "limit_reached") {
    return `Stopped because the maximum of ${run.invoiceLimit} invoices was reached.`;
  }

  if (run.completionReason === "queue_exhausted") {
    return "Stopped because every eligible invoice in this run was processed.";
  }

  return "";
}

export function decideProcessingTick(run: PersistedProcessingRun | null, now: Date): ProcessingPeek {
  if (!run || run.status === "completed") {
    return { action: "idle" };
  }

  if (run.status === "paused") {
    return { action: "paused", run };
  }

  if (run.leaseUntil && Date.parse(run.leaseUntil) > now.getTime()) {
    return { action: "busy", run };
  }

  return { action: "process", run };
}

export function shouldAdvanceProcessing(
  discovery: { status: string; needsAttention?: boolean },
  peek: ProcessingPeek
) {
  return peek.action === "process" && discovery.status !== "running" && discovery.needsAttention !== true;
}

export function countsFromAttempts(attempts: readonly ProcessingAttempt[]) {
  return {
    promoted: attempts.filter((attempt) => attempt.outcome === "promoted").length,
    duplicate: attempts.filter((attempt) => attempt.outcome === "duplicate").length,
    skipped: attempts.filter((attempt) => attempt.outcome === "skipped").length,
    failed: attempts.filter((attempt) => attempt.outcome === "failed").length,
    extractionFailures: attempts.filter((attempt) => attempt.extractionFailed).length,
  };
}

export function heldAttemptIds(attempts: readonly ProcessingAttempt[]) {
  return attempts
    .filter((attempt) => attempt.outcome === "failed" || attempt.outcome === "skipped")
    .map((attempt) => attempt.itemId);
}

export function remainingInScope(scopeItemIds: readonly string[], doneItemIds: readonly string[]) {
  const done = new Set(doneItemIds);
  return scopeItemIds.filter((itemId) => !done.has(itemId)).length;
}

export function authoriseProcessingBatch(input: {
  scopeItemIds: readonly string[];
  attemptedItemIds: readonly string[];
  requestedItemIds: readonly string[];
  batchSize: number;
}) {
  const scope = new Set(input.scopeItemIds);
  const attempted = new Set(input.attemptedItemIds);
  const room = input.scopeItemIds.filter((itemId) => !attempted.has(itemId)).length;
  const size = Math.min(Math.max(0, Math.floor(input.batchSize)), room);
  const chosen: string[] = [];

  for (const itemId of input.requestedItemIds) {
    if (chosen.length >= size) {
      break;
    }

    if (!scope.has(itemId) || attempted.has(itemId) || chosen.includes(itemId)) {
      continue;
    }

    chosen.push(itemId);
  }

  return chosen;
}

export function nextProcessingBatch(run: PersistedProcessingRun, rows: readonly PromotionPreviewRow[]) {
  if (!run.scopeSealed) {
    return [];
  }

  const allowed = new Set(run.scopeItemIds);
  const scoped = rows.filter((row) => allowed.has(row.itemId));

  return authoriseProcessingBatch({
    scopeItemIds: run.scopeItemIds,
    attemptedItemIds: run.attemptedItemIds,
    requestedItemIds: nextBulkBatch(scoped, run.batchSize, run.attemptedItemIds),
    batchSize: run.batchSize,
  });
}

export function blockedScopeItems(run: PersistedProcessingRun, rows: readonly PromotionPreviewRow[]) {
  if (!run.scopeSealed) {
    return [];
  }

  const selectable = new Set(rows.filter((row) => row.selectable).map((row) => row.itemId));
  const attempted = new Set(run.attemptedItemIds);

  return run.scopeItemIds.filter((itemId) => !attempted.has(itemId) && !selectable.has(itemId));
}

export function acceptScopeResults(run: PersistedProcessingRun, results: readonly PromotionOutcome[]): PromotionReport {
  const accepted = results.filter(
    (result) => run.scopeItemIds.includes(result.itemId) && !run.attemptedItemIds.includes(result.itemId)
  );

  return {
    promoted: accepted.filter((result) => result.outcome === "promoted").length,
    duplicate: accepted.filter((result) => result.outcome === "duplicate").length,
    skipped: accepted.filter((result) => result.outcome === "skipped").length,
    failed: accepted.filter((result) => result.outcome === "failed").length,
    results: accepted,
  };
}

export function outcomesForBlockedScope(run: PersistedProcessingRun, rows: readonly PromotionPreviewRow[]): PromotionReport {
  const byId = new Map(rows.map((row) => [row.itemId, row]));
  const results: PromotionOutcome[] = blockedScopeItems(run, rows)
    .slice(0, Math.max(run.batchSize, 1))
    .map((itemId) => {
      const row = byId.get(itemId);

      if (row?.duplicate) {
        return {
          itemId,
          filename: row.filename,
          supplierName: row.supplierName,
          invoiceNumber: row.invoiceNumber,
          invoiceDate: row.invoiceDate,
          outcome: "duplicate" as const,
          invoiceId: row.duplicate.invoiceId,
          extractionFailed: false,
          detail: row.duplicate.detail,
        };
      }

      return {
        itemId,
        filename: row?.filename ?? "Stored invoice",
        supplierName: row?.supplierName ?? null,
        invoiceNumber: row?.invoiceNumber ?? null,
        invoiceDate: row?.invoiceDate ?? null,
        outcome: "skipped" as const,
        invoiceId: null,
        extractionFailed: false,
        detail: "This invoice is no longer eligible for this run.",
      };
    });

  return {
    promoted: 0,
    duplicate: results.filter((result) => result.outcome === "duplicate").length,
    skipped: results.filter((result) => result.outcome === "skipped").length,
    failed: 0,
    results,
  };
}

function compareHistoricalInvoices(left: PromotionPreviewRow, right: PromotionPreviewRow) {
  const date = (left.invoiceDate ?? "9999-99-99").localeCompare(right.invoiceDate ?? "9999-99-99");

  if (date !== 0) {
    return date;
  }

  return (left.invoiceNumber ?? left.filename).localeCompare(right.invoiceNumber ?? right.filename);
}
