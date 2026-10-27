import type { SupabaseClient } from "@supabase/supabase-js";

import { GMAIL_ONGOING_SYNC_ENABLED } from "@/lib/gmail/config";
import { classifyDocumentRelevance, type DocumentRelevance } from "@/lib/gmail/relevance";
import { GMAIL_PROMOTION_BATCH_LIMIT, type PromotionOutcome, type PromotionReport } from "@/lib/materials/invoices/gmail-promotion-view";
import { advanceStoredInvoiceProcessing } from "@/lib/materials/invoices/processing-tick";
import {
  loadInvoiceProcessingView,
  pauseInvoiceProcessingRun,
  resumeInvoiceProcessingRun,
  startInvoiceProcessingRun,
} from "@/lib/materials/invoices/processing-store";

export const HISTORICAL_SCOPE_LIMIT = 50;
export const HISTORICAL_TICK_BATCH = GMAIL_PROMOTION_BATCH_LIMIT;

export type HistoricalDocumentKind = "invoice" | "statement" | "remittance" | "receipt" | "other";

export type HistoricalCandidate = {
  itemId: string;
  supplierId: string | null;
  filename: string;
  documentType: string;
  status: string;
  relevance: DocumentRelevance | null;
  duplicate: boolean;
  kind: HistoricalDocumentKind;
  invoiceDate: string | null;
  invoiceNumber: string | null;
};

export type HistoricalScopeRun = {
  id: string;
  status: "running" | "paused" | "completed";
  scopeItemIds: readonly string[];
  scopeSealed: boolean;
  invoiceLimit: number;
};

export type HistoricalAdvance = {
  status: string;
  pending?: number;
  report?: PromotionReport;
  error?: string;
};

export type HistoricalBulkPorts = {
  loadOpenRun: () => Promise<HistoricalScopeRun | null>;
  startSealedRun: (request: {
    scopeItemIds: string[];
    invoiceLimit: number;
    eligibleAtStart: number;
    batchSize: number;
  }) => Promise<HistoricalScopeRun>;
  resume: (runId: string) => Promise<void>;
  pause: (runId: string) => Promise<void>;
  setSupplierEnabled: (enabled: boolean) => Promise<void>;
  advance: () => Promise<HistoricalAdvance>;
};

export type HistoricalBulkResult = {
  ok: boolean;
  status: "completed" | "paused" | "refused";
  runId: string | null;
  reason: string | null;
  promoted: number;
  duplicate: number;
  skipped: number;
  failed: number;
  outcomes: PromotionOutcome[];
};

export function classifyHistoricalDocument(input: { filename?: string | null; text: string }) {
  const relevance = classifyDocumentRelevance(input.text);
  const name = (input.filename ?? "").toLowerCase();

  if (/\bdunning\b/.test(name)) {
    return {
      kind: "other" as const,
      relevance: "irrelevant" as const,
      reason: "Excluded as irrelevant: credit-control letter.",
    };
  }

  if (relevance.relevance === "supplier_invoice") {
    return { kind: "invoice" as const, relevance: relevance.relevance, reason: relevance.reason };
  }

  if (/\bremittance advice\b/.test(name) || relevance.reason.includes("remittance advice")) {
    return {
      kind: "remittance" as const,
      relevance: "irrelevant" as const,
      reason: "Excluded as irrelevant: remittance advice.",
    };
  }

  if (relevance.reason.includes("receipt") || /\b(?:payment|official)\s+receipt\b|\breceipt\b/.test(name)) {
    return {
      kind: "receipt" as const,
      relevance: "irrelevant" as const,
      reason: "Excluded as irrelevant: receipt.",
    };
  }

  if (relevance.reason.includes("supplier statement") || /\bstatement\b/.test(name)) {
    return {
      kind: "statement" as const,
      relevance: "irrelevant" as const,
      reason: "Excluded as irrelevant: supplier statement.",
    };
  }

  return { kind: "other" as const, relevance: relevance.relevance, reason: relevance.reason };
}

export function selectHistoricalSupplierScope(
  candidates: readonly HistoricalCandidate[],
  supplierId: string,
  limit = HISTORICAL_SCOPE_LIMIT
) {
  const cap = Math.min(HISTORICAL_SCOPE_LIMIT, Math.max(0, Math.floor(limit)));

  return candidates
    .filter(
      (candidate) =>
        candidate.supplierId === supplierId &&
        candidate.kind === "invoice" &&
        candidate.relevance === "supplier_invoice" &&
        candidate.documentType === "invoice" &&
        candidate.status === "stored" &&
        !candidate.duplicate
    )
    .sort(compareCandidates)
    .slice(0, cap)
    .map((candidate) => candidate.itemId);
}

export function historicalRunRequest(scopeItemIds: readonly string[]) {
  const ids = [...new Set(scopeItemIds.map((id) => id.trim()).filter(Boolean))];

  if (ids.length === 0 || ids.length > HISTORICAL_SCOPE_LIMIT) {
    return null;
  }

  return {
    scopeItemIds: ids,
    invoiceLimit: ids.length,
    eligibleAtStart: ids.length,
    batchSize: HISTORICAL_TICK_BATCH,
  };
}

export function summariseHistoricalCandidates(candidates: readonly HistoricalCandidate[]) {
  const count = (kind: HistoricalDocumentKind) => candidates.filter((candidate) => candidate.kind === kind).length;

  return {
    invoices: count("invoice"),
    statements: count("statement"),
    remittances: count("remittance"),
    receipts: count("receipt"),
    other: count("other"),
    duplicates: candidates.filter((candidate) => candidate.duplicate).length,
    manual: candidates.filter((candidate) => candidate.kind === "invoice" && !candidate.supplierId).length,
  };
}

export async function runHistoricalSupplierScope(input: {
  scopeItemIds: readonly string[];
  discoveryEnabled: boolean;
  ports: HistoricalBulkPorts;
}): Promise<HistoricalBulkResult> {
  const request = historicalRunRequest(input.scopeItemIds);

  if (input.discoveryEnabled) {
    return refused("Historical processing does not run while Gmail discovery is enabled.");
  }

  if (!request) {
    return refused("A historical run must contain between 1 and 50 stored invoices.");
  }

  const open = await input.ports.loadOpenRun();

  if (open && !sameScope(open, request.scopeItemIds)) {
    return refused("Another processing run is already open.");
  }

  let run = open;
  let enabled = false;
  let completed = false;
  const outcomes: PromotionOutcome[] = [];

  try {
    if (!run) {
      run = await input.ports.startSealedRun(request);
    } else if (run.status === "paused") {
      await input.ports.resume(run.id);
      run = { ...run, status: "running" };
    }

    if (!sameScope(run, request.scopeItemIds)) {
      await input.ports.pause(run.id);
      return refused("The sealed scope does not match the approved invoices.", run.id);
    }

    await input.ports.setSupplierEnabled(true);
    enabled = true;

    for (let step = 0; step < request.scopeItemIds.length + 2; step += 1) {
      const tick = await input.ports.advance();
      outcomes.push(...(tick.report?.results ?? []));

      if (tick.status === "completed" || tick.pending === 0) {
        completed = true;
        break;
      }

      if (tick.status !== "running") {
        break;
      }
    }
  } finally {
    if (run && !completed) {
      try {
        await input.ports.pause(run.id);
      } catch {
        // The supplier flag still has to be turned off.
      }
    }

    if (enabled) {
      await input.ports.setSupplierEnabled(false);
    }
  }

  return {
    ok: completed,
    status: completed ? "completed" : "paused",
    runId: run?.id ?? null,
    reason: completed ? null : "Processing stopped before every sealed invoice was attempted.",
    ...countOutcomes(outcomes),
  };
}

export async function setHistoricalSupplierEnabled(
  supabase: SupabaseClient,
  supplierId: string,
  enabled: boolean
) {
  const { data, error } = await supabase
    .from("suppliers")
    .update({ gmail_auto_processing_enabled: enabled })
    .eq("id", supplierId)
    .select("id, gmail_auto_processing_enabled");

  if (error || data?.length !== 1 || data[0]?.gmail_auto_processing_enabled !== enabled) {
    throw new Error(enabled ? "The supplier could not be enabled." : "The supplier could not be disabled.");
  }
}

export async function runStoredHistoricalSupplier(
  supabase: SupabaseClient,
  input: { userId: string; supplierId: string; scopeItemIds: readonly string[] }
) {
  return runHistoricalSupplierScope({
    scopeItemIds: input.scopeItemIds,
    discoveryEnabled: GMAIL_ONGOING_SYNC_ENABLED,
    ports: {
      async loadOpenRun() {
        const view = await loadInvoiceProcessingView(supabase);

        if (!view.available || !view.run || view.run.status === "completed") {
          return null;
        }

        return {
          id: view.run.id,
          status: view.run.status,
          scopeItemIds: view.run.scopeItemIds,
          scopeSealed: view.run.scopeSealed,
          invoiceLimit: view.run.invoiceLimit,
        };
      },
      async startSealedRun(request) {
        const started = await startInvoiceProcessingRun(supabase, {
          userId: input.userId,
          ...request,
        });

        if (!started.available || !started.run) {
          throw new Error("The processing run could not be created.");
        }

        return {
          id: started.run.id,
          status: started.run.status,
          scopeItemIds: started.run.scopeItemIds,
          scopeSealed: started.run.scopeSealed,
          invoiceLimit: started.run.invoiceLimit,
        };
      },
      resume: (runId) => resumeInvoiceProcessingRun(supabase, runId),
      pause: (runId) => pauseInvoiceProcessingRun(supabase, runId),
      setSupplierEnabled: (enabled) => setHistoricalSupplierEnabled(supabase, input.supplierId, enabled),
      async advance() {
        const tick = await advanceStoredInvoiceProcessing(supabase, input.userId);
        return { status: tick.status, pending: tick.pending, report: tick.report, error: tick.error };
      },
    },
  });
}

function compareCandidates(left: HistoricalCandidate, right: HistoricalCandidate) {
  const date = (left.invoiceDate ?? "9999-99-99").localeCompare(right.invoiceDate ?? "9999-99-99");
  return date === 0 ? (left.invoiceNumber ?? left.filename).localeCompare(right.invoiceNumber ?? right.filename) : date;
}

function sameScope(run: HistoricalScopeRun, ids: readonly string[]) {
  const scope = new Set(run.scopeItemIds);
  return (
    run.scopeSealed &&
    run.invoiceLimit === ids.length &&
    run.scopeItemIds.length === ids.length &&
    ids.every((id) => scope.has(id))
  );
}

function countOutcomes(outcomes: readonly PromotionOutcome[]) {
  const latest = new Map<string, PromotionOutcome>();

  for (const outcome of outcomes) {
    latest.set(outcome.itemId, outcome);
  }

  const rows = [...latest.values()];
  return {
    promoted: rows.filter((row) => row.outcome === "promoted").length,
    duplicate: rows.filter((row) => row.outcome === "duplicate").length,
    skipped: rows.filter((row) => row.outcome === "skipped").length,
    failed: rows.filter((row) => row.outcome === "failed").length,
    outcomes: rows,
  };
}

function refused(reason: string, runId: string | null = null): HistoricalBulkResult {
  return {
    ok: false,
    status: "refused",
    runId,
    reason,
    promoted: 0,
    duplicate: 0,
    skipped: 0,
    failed: 0,
    outcomes: [],
  };
}
