import type { SupabaseClient } from "@supabase/supabase-js";

import { clampBulkBatchSize } from "@/lib/materials/invoices/gmail-bulk";
import type { PromotionReport } from "@/lib/materials/invoices/gmail-promotion-view";
import {
  countsFromAttempts,
  decideProcessingTick,
  heldAttemptIds,
  type InvoiceProcessingCompletionReason,
  type PersistedProcessingRun,
  type ProcessingPeek,
  type PersistedProcessingStatus,
  type ProcessingAttempt,
} from "@/lib/materials/invoices/processing-run";
import { isMaterialsSchemaMissing } from "@/lib/materials/write-error";

const RUNS = "invoice_processing_runs";
const ATTEMPTS = "invoice_processing_attempts";
const SCOPE = "invoice_processing_scope";
const RUN_COLUMNS =
  "id, status, batch_size, invoice_limit, eligible_at_start, scope_sealed, completion_reason, promoted_count, duplicate_count, skipped_count, failed_count, extraction_failure_count, last_error, lease_until, started_by";

type RunRow = {
  id: string;
  status: PersistedProcessingStatus;
  batch_size: number;
  invoice_limit: number;
  eligible_at_start: number;
  scope_sealed: boolean;
  completion_reason: InvoiceProcessingCompletionReason | null;
  promoted_count: number;
  duplicate_count: number;
  skipped_count: number;
  failed_count: number;
  extraction_failure_count: number;
  last_error: string | null;
  lease_until: string | null;
  started_by: string | null;
};

type AttemptRow = {
  gmail_import_item_id: string;
  outcome: ProcessingAttempt["outcome"];
  extraction_failed: boolean;
  detail: string | null;
  created_at: string;
};

export async function loadInvoiceProcessingView(supabase: SupabaseClient): Promise<
  | { available: false }
  | { available: true; run: PersistedProcessingRun | null }
> {
  const { data, error } = await supabase
    .from(RUNS)
    .select(RUN_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMaterialsSchemaMissing(error)) {
      return { available: false };
    }

    throw new Error("Background processing could not be loaded.");
  }

  if (!data) {
    return { available: true, run: null };
  }

  const row = data as RunRow;
  const [attempts, scopeItemIds] = await Promise.all([
    loadAttempts(supabase, row.id),
    loadScope(supabase, row.id),
  ]);

  if (!scopeItemIds) {
    return { available: false };
  }

  return { available: true, run: mapRun(row, attempts, scopeItemIds) };
}

export async function peekInvoiceProcessing(supabase: SupabaseClient): Promise<ProcessingPeek> {
  try {
    const view = await loadInvoiceProcessingView(supabase);

    if (!view.available) {
      return { action: "unavailable" };
    }

    return decideProcessingTick(view.run, new Date());
  } catch {
    return { action: "unavailable" };
  }
}

export async function startInvoiceProcessingRun(
  supabase: SupabaseClient,
  input: {
    userId: string;
    batchSize: number;
    invoiceLimit: number;
    eligibleAtStart: number;
    scopeItemIds: readonly string[];
  }
) {
  const current = await loadInvoiceProcessingView(supabase);

  if (!current.available) {
    return current;
  }

  if (current.run && (current.run.status === "running" || current.run.status === "paused")) {
    if (current.run.status === "paused") {
      await supabase
        .from(RUNS)
        .update({ status: "running", lease_until: null, batch_size: clampBulkBatchSize(input.batchSize) })
        .eq("id", current.run.id)
        .eq("status", "paused");
    }

    return loadInvoiceProcessingView(supabase);
  }

  const scopeItemIds = [...new Set(input.scopeItemIds)].slice(0, input.invoiceLimit);
  const { data, error } = await supabase
    .from(RUNS)
    .insert({
      status: "running",
      batch_size: clampBulkBatchSize(input.batchSize),
      invoice_limit: input.invoiceLimit,
      eligible_at_start: input.eligibleAtStart,
      scope_sealed: false,
      started_by: input.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    if (error && isUniqueViolation(error)) {
      return loadInvoiceProcessingView(supabase);
    }

    if (error && isMaterialsSchemaMissing(error)) {
      return { available: false as const };
    }

    throw new Error("Background processing could not be started.");
  }

  if (scopeItemIds.length > 0) {
    const { error: scopeError } = await supabase.from(SCOPE).insert(
      scopeItemIds.map((itemId, index) => ({
        run_id: data.id,
        gmail_import_item_id: itemId,
        position: index + 1,
      }))
    );

    if (scopeError) {
      await supabase
        .from(RUNS)
        .update({
          status: "paused",
          scope_sealed: true,
          lease_until: null,
          last_error: "The invoices for this run could not be fixed.",
        })
        .eq("id", data.id);
      throw new Error("Background processing could not be started.");
    }
  }

  const { error: sealError } = await supabase.from(RUNS).update({ scope_sealed: true }).eq("id", data.id);

  if (sealError) {
    await supabase
      .from(RUNS)
      .update({
        status: "paused",
        scope_sealed: true,
        lease_until: null,
        last_error: "The invoices for this run could not be fixed.",
      })
      .eq("id", data.id);
    throw new Error("Background processing could not be started.");
  }

  return loadInvoiceProcessingView(supabase);
}

export async function pauseInvoiceProcessingRun(supabase: SupabaseClient, runId: string) {
  const { error } = await supabase
    .from(RUNS)
    .update({ status: "paused", lease_until: null })
    .eq("id", runId)
    .eq("status", "running");

  if (error) {
    throw new Error("Background processing could not be paused.");
  }
}

export async function resumeInvoiceProcessingRun(supabase: SupabaseClient, runId: string) {
  const { error } = await supabase
    .from(RUNS)
    .update({ status: "running", lease_until: null })
    .eq("id", runId)
    .eq("status", "paused");

  if (error) {
    throw new Error("Background processing could not be resumed.");
  }
}

export async function retryFailedProcessingAttempts(supabase: SupabaseClient, runId: string) {
  const { error: deleteError } = await supabase
    .from(ATTEMPTS)
    .delete()
    .eq("run_id", runId)
    .eq("outcome", "failed");

  if (deleteError) {
    throw new Error("Failed invoices could not be queued again.");
  }

  const attempts = await loadAttempts(supabase, runId);
  const counts = countsFromAttempts(attempts);
  const { error } = await supabase
    .from(RUNS)
    .update({
      status: "running",
      lease_until: null,
      last_error: null,
      completion_reason: null,
      promoted_count: counts.promoted,
      duplicate_count: counts.duplicate,
      skipped_count: counts.skipped,
      failed_count: counts.failed,
      extraction_failure_count: counts.extractionFailures,
    })
    .eq("id", runId)
    .in("status", ["running", "paused", "completed"]);

  if (error) {
    throw new Error("Failed invoices could not be queued again.");
  }
}

export async function claimInvoiceProcessingRun(supabase: SupabaseClient, runId: string) {
  const { data, error } = await supabase.rpc("claim_invoice_processing_run", {
    target_id: runId,
    lease_seconds: 120,
  });

  if (error) {
    throw new Error("Background processing could not be locked.");
  }

  return data === true;
}

export async function releaseInvoiceProcessingRun(supabase: SupabaseClient, runId: string) {
  await supabase.from(RUNS).update({ lease_until: null }).eq("id", runId);
}

export async function recordInvoiceProcessingReport(
  supabase: SupabaseClient,
  runId: string,
  report: PromotionReport,
  pending: number,
  completionReason: InvoiceProcessingCompletionReason | null = null
) {
  if (report.results.length > 0) {
    const { error } = await supabase.from(ATTEMPTS).upsert(
      report.results.map((result) => ({
        run_id: runId,
        gmail_import_item_id: result.itemId,
        outcome: result.outcome,
        supplier_invoice_id: result.invoiceId,
        extraction_failed: result.extractionFailed,
        detail: result.detail.slice(0, 500),
      })),
      { onConflict: "run_id,gmail_import_item_id" }
    );

    if (error) {
      throw new Error("The processing result could not be saved.");
    }
  }

  const counts = countsFromAttempts(await loadAttempts(supabase, runId));
  const { error: updateError } = await supabase
    .from(RUNS)
    .update({
      promoted_count: counts.promoted,
      duplicate_count: counts.duplicate,
      skipped_count: counts.skipped,
      failed_count: counts.failed,
      extraction_failure_count: counts.extractionFailures,
      lease_until: null,
      last_error: null,
      ...(pending === 0 ? { status: "completed" as const, completion_reason: completionReason } : {}),
    })
    .eq("id", runId)
    .in("status", ["running", "paused"]);

  if (updateError) {
    throw new Error("The processing result could not be saved.");
  }
}

export async function noteInvoiceProcessingError(supabase: SupabaseClient, runId: string, message: string) {
  await supabase
    .from(RUNS)
    .update({ last_error: message.slice(0, 500), lease_until: null })
    .eq("id", runId)
    .in("status", ["running", "paused"]);
}

export async function completeInvoiceProcessingRun(
  supabase: SupabaseClient,
  runId: string,
  completionReason: InvoiceProcessingCompletionReason
) {
  await supabase
    .from(RUNS)
    .update({ status: "completed", lease_until: null, last_error: null, completion_reason: completionReason })
    .eq("id", runId)
    .in("status", ["running", "paused"]);
}

async function loadAttempts(supabase: SupabaseClient, runId: string) {
  const { data, error } = await supabase
    .from(ATTEMPTS)
    .select("gmail_import_item_id, outcome, extraction_failed, detail, created_at")
    .eq("run_id", runId)
    .order("created_at", { ascending: false });

  if (error) {
    if (isMaterialsSchemaMissing(error)) {
      return [];
    }

    throw new Error("Background processing could not be loaded.");
  }

  return ((data ?? []) as AttemptRow[]).map(
    (row): ProcessingAttempt => ({
      itemId: row.gmail_import_item_id,
      outcome: row.outcome,
      extractionFailed: row.extraction_failed,
      detail: row.detail ?? "",
    })
  );
}

async function loadScope(supabase: SupabaseClient, runId: string) {
  const { data, error } = await supabase
    .from(SCOPE)
    .select("gmail_import_item_id, position")
    .eq("run_id", runId)
    .order("position", { ascending: true });

  if (error) {
    if (isMaterialsSchemaMissing(error)) {
      return null;
    }

    throw new Error("Background processing could not be loaded.");
  }

  return ((data ?? []) as Array<{ gmail_import_item_id: string }>).map((row) => row.gmail_import_item_id);
}

function mapRun(row: RunRow, attempts: ProcessingAttempt[], scopeItemIds: string[]): PersistedProcessingRun {
  const counts = attempts.length > 0 ? countsFromAttempts(attempts) : null;

  return {
    id: row.id,
    status: row.status,
    batchSize: row.batch_size,
    invoiceLimit: row.invoice_limit,
    eligibleAtStart: row.eligible_at_start,
    scopeItemIds,
    scopeSealed: row.scope_sealed,
    completionReason: row.completion_reason,
    promoted: counts?.promoted ?? row.promoted_count,
    duplicate: counts?.duplicate ?? row.duplicate_count,
    skipped: counts?.skipped ?? row.skipped_count,
    failed: counts?.failed ?? row.failed_count,
    extractionFailures: counts?.extractionFailures ?? row.extraction_failure_count,
    lastError: row.last_error,
    leaseUntil: row.lease_until,
    startedBy: row.started_by,
    heldItemIds: heldAttemptIds(attempts),
    failedItemIds: attempts.filter((attempt) => attempt.outcome === "failed").map((attempt) => attempt.itemId),
    attemptedItemIds: attempts.map((attempt) => attempt.itemId),
    recent: attempts.slice(0, 20),
  };
}

function isUniqueViolation(error: { code?: string }) {
  return error.code === "23505";
}
