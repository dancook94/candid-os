import type { SupabaseClient } from "@supabase/supabase-js";

import { loadGmailPromotionPreview, promoteGmailInvoiceBatch } from "@/lib/materials/invoices/gmail-promotion";
import type { PromotionPreviewRow, PromotionReport } from "@/lib/materials/invoices/gmail-promotion-view";
import { loadInvoiceMatchCatalog } from "@/lib/materials/invoices/queries";
import {
  claimInvoiceProcessingRun,
  completeInvoiceProcessingRun,
  loadInvoiceProcessingView,
  noteInvoiceProcessingError,
  recordInvoiceProcessingReport,
  releaseInvoiceProcessingRun,
} from "@/lib/materials/invoices/processing-store";
import {
  decideProcessingTick,
  acceptScopeResults,
  nextProcessingBatch,
  outcomesForBlockedScope,
  remainingInScope,
  runCompletionReason,
  type InvoiceProcessingCompletionReason,
  type PersistedProcessingRun,
} from "@/lib/materials/invoices/processing-run";

export type ProcessingTickResult = {
  status: "idle" | "paused" | "busy" | "running" | "completed" | "attention";
  pending?: number;
  error?: string;
  report?: PromotionReport;
};

type ProcessingPorts = {
  now?: Date;
  loadRun: () => Promise<PersistedProcessingRun | null>;
  claim: (runId: string) => Promise<boolean>;
  release: (runId: string) => Promise<void>;
  loadPreview: () => Promise<{ ok: true; rows: PromotionPreviewRow[] } | { ok: false; error: string }>;
  promote: (itemIds: string[], run: PersistedProcessingRun) => Promise<PromotionReport>;
  record: (
    runId: string,
    report: PromotionReport,
    pending: number,
    completionReason: InvoiceProcessingCompletionReason | null
  ) => Promise<void>;
  noteError: (runId: string, message: string) => Promise<void>;
  complete: (runId: string, completionReason: InvoiceProcessingCompletionReason) => Promise<void>;
};

export async function advanceInvoiceProcessing(input: ProcessingPorts): Promise<ProcessingTickResult> {
  const decision = decideProcessingTick(await input.loadRun(), input.now ?? new Date());

  if (decision.action === "idle" || decision.action === "unavailable") {
    return { status: "idle" };
  }

  if (decision.action === "paused") {
    return { status: "paused" };
  }

  if (decision.action === "busy") {
    return { status: "busy" };
  }

  const run = decision.run;
  const claimed = await input.claim(run.id);

  if (!claimed) {
    return { status: "busy" };
  }

  try {
    if (!run.scopeSealed) {
      return { status: "busy" };
    }

    const preview = await input.loadPreview();

    if (!preview.ok) {
      await input.noteError(run.id, preview.error);
      return { status: "attention", error: preview.error };
    }

    const itemIds = nextProcessingBatch(run, preview.rows);
    const blocked = itemIds.length === 0 ? outcomesForBlockedScope(run, preview.rows) : null;

    if (itemIds.length === 0 && (blocked?.results.length ?? 0) === 0) {
      const completionReason = runCompletionReason(run);
      await input.complete(run.id, completionReason);
      return { status: "completed", pending: 0 };
    }

    const report = acceptScopeResults(run, blocked?.results ?? (await input.promote(itemIds, run)).results);
    const pending = remainingInScope(run.scopeItemIds, [
      ...run.attemptedItemIds,
      ...report.results.map((result) => result.itemId),
    ]);
    const completionReason = pending === 0 ? runCompletionReason(run) : null;
    await input.record(run.id, report, pending, completionReason);

    if (pending === 0) {
      await input.complete(run.id, completionReason ?? runCompletionReason(run));
    }

    return { status: pending === 0 ? "completed" : "running", pending, report };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The stored invoices could not be processed.";
    await input.noteError(run.id, message);
    return { status: "attention", error: message };
  } finally {
    await input.release(run.id);
  }
}

export async function advanceStoredInvoiceProcessing(supabase: SupabaseClient, userId?: string) {
  return advanceInvoiceProcessing({
    loadRun: async () => {
      const view = await loadInvoiceProcessingView(supabase);
      return view.available ? view.run : null;
    },
    claim: (runId) => claimInvoiceProcessingRun(supabase, runId),
    release: (runId) => releaseInvoiceProcessingRun(supabase, runId),
    loadPreview: () => loadGmailPromotionPreview(supabase),
    promote: async (itemIds, run) => {
      const owner = userId ?? run.startedBy;

      if (!owner) {
        throw new Error("This processing run has no owner.");
      }

      const catalog = await loadInvoiceMatchCatalog(supabase);

      if (!catalog.ok) {
        throw new Error(catalog.error);
      }

      return promoteGmailInvoiceBatch({ supabase, userId: owner, itemIds, catalog });
    },
    record: (runId, report, pending, completionReason) =>
      recordInvoiceProcessingReport(supabase, runId, report, pending, completionReason),
    noteError: (runId, message) => noteInvoiceProcessingError(supabase, runId, message),
    complete: (runId, completionReason) => completeInvoiceProcessingRun(supabase, runId, completionReason),
  });
}
