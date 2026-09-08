import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchPrintfactoryJobsBounded,
  getPrintfactoryConnectionStatus,
} from "@/lib/printfactory/client";
import { enrichPrintfactoryJobsWithSourcePaths } from "@/lib/printfactory/source-path-enrichment";
import { PrintfactoryError } from "@/lib/printfactory/errors";
import {
  batchMatchPrintfactoryJobs,
  batchUpsertPrintfactoryJobs,
  loadExistingPrintfactoryRows,
} from "@/lib/printfactory/sync-processor";
import {
  logSyncFailure,
  normalizeSyncError,
} from "@/lib/printfactory/sync-errors";
import { buildSyncSummaryMessage } from "@/lib/printfactory/sync-summary";
import {
  createSyncStageTimer,
  logSyncErrorDev,
  type SyncStageName,
  type SyncStageTiming,
} from "@/lib/printfactory/sync-timing";

export type PrintfactorySyncMode = "live";

export type PrintfactorySyncResult = {
  ok: boolean;
  partial: boolean;
  syncMode: PrintfactorySyncMode;
  imported: number;
  updated: number;
  /** @deprecated use updated — existing rows refreshed via upsert */
  alreadyCurrent: number;
  refreshed: number;
  parentJobsAutoMatched: number;
  parentJobSuggestions: number;
  itemSuggestions: number;
  confirmedLinks: number;
  needsAttention: number;
  ignored: number;
  errors: number;
  pagesFetched: number;
  recordsReceived: number;
  recordsProcessed: number;
  accountTotal: number | null;
  filteredTotal: number | null;
  hasMore: boolean;
  nextCursor: number | null;
  skipCursor: number;
  windowCapped: boolean;
  dateTimeFrom: string | null;
  dateTimeTo: string | null;
  elapsedMs: number;
  failingStage: SyncStageName | null;
  stageTimings: SyncStageTiming[];
  matched: number;
  unmatched: number;
  suggested: number;
  failed: number;
  itemSuggestionsCreated: number;
  error: string | null;
  errorCode: string | null;
  safeMessage: string | null;
  connectionStatus: ReturnType<typeof getPrintfactoryConnectionStatus>;
  summaryMessage: string | null;
};

export type SyncBatchRequest = {
  dateTimeFrom: string;
  dateTimeTo: string;
  skip: number;
  maxRecords: number;
  maxPages: number;
  pageSize: number;
  upsertBatchSize: number;
  matchBatchSize: number;
};

export type SyncBatchContext = {
  adminClient: SupabaseClient;
  actorProfileId?: string | null;
  attemptedAt: string;
  request: SyncBatchRequest;
  onFailureState?: (input: {
    normalizedError: ReturnType<typeof normalizeSyncError>;
    partialSuccess: boolean;
    recordsReceived: number;
    hasMore: boolean;
    nextCursor: number | null;
  }) => Promise<void>;
  onSuccessState?: (input: {
    recordsReceived: number;
    imported: number;
    updated: number;
    hasMore: boolean;
    nextCursor: number | null;
    windowCapped: boolean;
  }) => Promise<void>;
};

async function countNeedsAttention(adminClient: SupabaseClient) {
  const { count, error } = await adminClient
    .from("printfactory_jobs")
    .select("id", { count: "exact", head: true })
    .in("job_match_status", ["unmatched", "suggested", "conflict"]);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

async function countIgnored(adminClient: SupabaseClient) {
  const { count, error } = await adminClient
    .from("printfactory_jobs")
    .select("id", { count: "exact", head: true })
    .eq("job_match_status", "ignored");

  if (error) {
    throw error;
  }

  return count ?? 0;
}

function emptyResult(
  timer: ReturnType<typeof createSyncStageTimer>,
  partial: Partial<PrintfactorySyncResult> = {}
): PrintfactorySyncResult {
  const connectionStatus = getPrintfactoryConnectionStatus();

  return {
    ok: false,
    partial: false,
    syncMode: "live",
    imported: 0,
    updated: 0,
    alreadyCurrent: 0,
    refreshed: 0,
    parentJobsAutoMatched: 0,
    parentJobSuggestions: 0,
    itemSuggestions: 0,
    confirmedLinks: 0,
    needsAttention: 0,
    ignored: 0,
    errors: 0,
    pagesFetched: 0,
    recordsReceived: 0,
    recordsProcessed: 0,
    accountTotal: null,
    filteredTotal: null,
    hasMore: false,
    nextCursor: null,
    skipCursor: 0,
    windowCapped: false,
    dateTimeFrom: null,
    dateTimeTo: null,
    elapsedMs: timer.getTimings().find((entry) => entry.stage === "total")?.elapsedMs ?? 0,
    failingStage: null,
    stageTimings: timer.getTimings(),
    matched: 0,
    unmatched: 0,
    suggested: 0,
    failed: 0,
    itemSuggestionsCreated: 0,
    error: null,
    errorCode: null,
    safeMessage: null,
    connectionStatus,
    summaryMessage: null,
    ...partial,
  };
}

export function detectWindowCapped(input: {
  recordsReceived: number;
  maxRecords: number;
  hasMore: boolean;
  filteredTotal: number | null;
}): boolean {
  if (input.hasMore) {
    return true;
  }

  if (input.filteredTotal != null && input.filteredTotal > input.recordsReceived) {
    return true;
  }

  return input.recordsReceived >= input.maxRecords;
}

export async function runPrintfactorySyncBatch(
  context: SyncBatchContext
): Promise<PrintfactorySyncResult> {
  const timer = createSyncStageTimer();
  const { adminClient, request, attemptedAt } = context;
  const connectionStatus = getPrintfactoryConnectionStatus();

  let imported = 0;
  let updated = 0;
  let parentJobsAutoMatched = 0;
  let parentJobSuggestions = 0;
  let pagesFetched = 0;
  let recordsReceived = 0;
  let accountTotal: number | null = null;
  let filteredTotal: number | null = null;
  let hasMore = false;
  let nextCursor: number | null = null;
  let failingStage: SyncStageName | null = null;
  let currentStage: SyncStageName = "api_request";
  let windowCapped = false;

  const finish = (partial: Partial<PrintfactorySyncResult>): PrintfactorySyncResult => {
    timer.logDevSummary({
      imported,
      updated,
      recordsReceived,
      pagesFetched,
      hasMore,
      failingStage,
      syncMode: "live",
    });

    return emptyResult(timer, {
      syncMode: "live",
      imported,
      updated,
      refreshed: updated,
      alreadyCurrent: updated,
      parentJobsAutoMatched,
      parentJobSuggestions,
      pagesFetched,
      recordsReceived,
      recordsProcessed: recordsReceived,
      accountTotal,
      filteredTotal,
      hasMore,
      nextCursor,
      skipCursor: request.skip,
      windowCapped,
      dateTimeFrom: request.dateTimeFrom,
      dateTimeTo: request.dateTimeTo,
      failingStage,
      stageTimings: timer.getTimings(),
      matched: parentJobsAutoMatched,
      suggested: parentJobSuggestions,
      connectionStatus,
      ...partial,
    });
  };

  const recordFailure = async (error: unknown, stage: SyncStageName | null) => {
    failingStage = stage;
    logSyncErrorDev(failingStage, error);

    const normalized = normalizeSyncError(error);
    logSyncFailure({
      failingStage,
      error,
      recordsReceived,
      imported,
      updated,
      syncWindowDateTimeFrom: request.dateTimeFrom,
      syncWindowDateTimeTo: request.dateTimeTo,
      printfactoryResponseStatus: normalized.printfactoryResponseStatus,
    });

    const partialSuccess = imported + updated > 0;
    const committedMessage = partialSuccess
      ? `Processed ${imported + updated} PrintFactory jobs, but ${failingStage?.replace(/_/g, " ")} failed. Committed records were retained.`
      : normalized.safeMessage;

    if (context.onFailureState) {
      await context.onFailureState({
        normalizedError: normalized,
        partialSuccess,
        recordsReceived,
        hasMore,
        nextCursor,
      });
    }

    if (error instanceof PrintfactoryError) {
      return finish({
        ok: partialSuccess,
        partial: partialSuccess,
        failingStage,
        error: committedMessage,
        safeMessage: normalized.safeMessage,
        errorCode: error.code,
        summaryMessage: partialSuccess ? committedMessage : null,
      });
    }

    return finish({
      ok: partialSuccess,
      partial: partialSuccess,
      failingStage,
      error: committedMessage,
      safeMessage: normalized.safeMessage,
      errorCode: normalized.errorCode,
      summaryMessage: partialSuccess ? committedMessage : null,
    });
  };

  try {
    timer.start("api_request");
    currentStage = "api_request";
    timer.start("pagination");

    const fetchResult = await fetchPrintfactoryJobsBounded({
      skip: request.skip,
      dateTimeFrom: request.dateTimeFrom,
      dateTimeTo: request.dateTimeTo,
      maxRecords: request.maxRecords,
      maxPages: request.maxPages,
      pageSize: request.pageSize,
    });

    timer.end("api_request", {
      pagesFetched: fetchResult.pagesFetched,
      recordsReceived: fetchResult.recordsReceived,
      accountTotal: fetchResult.accountTotal,
      filteredTotal: fetchResult.filteredTotal,
    });
    timer.end("pagination", {
      hasMore: fetchResult.hasMore,
      nextSkip: fetchResult.nextSkip,
    });

    pagesFetched = fetchResult.pagesFetched;
    recordsReceived = fetchResult.recordsReceived;
    accountTotal = fetchResult.accountTotal;
    filteredTotal = fetchResult.filteredTotal;
    hasMore = fetchResult.hasMore;
    nextCursor = fetchResult.nextSkip;
    windowCapped = detectWindowCapped({
      recordsReceived,
      maxRecords: request.maxRecords,
      hasMore,
      filteredTotal,
    });

    if (fetchResult.jobs.length === 0) {
      if (context.onSuccessState) {
        await context.onSuccessState({
          recordsReceived: 0,
          imported: 0,
          updated: 0,
          hasMore: false,
          nextCursor: null,
          windowCapped: false,
        });
      }

      return finish({
        ok: true,
        summaryMessage: buildSyncSummaryMessage({
          recordsReceived: 0,
          imported: 0,
          refreshed: 0,
          parentJobsAutoMatched: 0,
          parentJobSuggestions: 0,
          needsAttention: 0,
          pagesFetched,
          hasMore: false,
          windowCapped: false,
          partial: false,
          failingStage: null,
          dateTimeFrom: request.dateTimeFrom,
          dateTimeTo: request.dateTimeTo,
        }),
      });
    }

    const now = new Date().toISOString();

    timer.start("normalization");
    currentStage = "normalization";
    timer.end("normalization", { recordsReceived: fetchResult.jobs.length });

    const existingByGuid = await loadExistingPrintfactoryRows(
      adminClient,
      fetchResult.jobs.map((job) => job.guid)
    );

    timer.start("detail_fetch");
    currentStage = "detail_fetch";

    const token =
      process.env.PRINTFACTORY_API_TOKEN?.trim() ||
      process.env.PRINTFACTORY_API_KEY?.trim() ||
      "";

    const enrichmentResult = await enrichPrintfactoryJobsWithSourcePaths(
      fetchResult.jobs,
      existingByGuid,
      token
    );

    timer.end("detail_fetch", {
      detailFetchCount: enrichmentResult.detailFetchCount,
      detailFetchFailures: enrichmentResult.detailFetchFailures,
      detailFetchSkipped: enrichmentResult.detailFetchSkipped,
    });

    timer.start("database_upsert");
    currentStage = "database_upsert";

    const upsertResult = await batchUpsertPrintfactoryJobs(
      adminClient,
      enrichmentResult.enrichedJobs,
      existingByGuid,
      now,
      request.upsertBatchSize
    );

    imported = upsertResult.imported;
    updated = upsertResult.updated;

    timer.end("database_upsert", {
      imported,
      updated,
      batchSize: request.upsertBatchSize,
    });

    timer.start("parent_job_matching");
    currentStage = "parent_job_matching";

    const matchResult = await batchMatchPrintfactoryJobs(
      adminClient,
      Array.from(upsertResult.rowByGuid.values()),
      request.matchBatchSize
    );

    parentJobsAutoMatched = matchResult.parentJobsAutoMatched;
    parentJobSuggestions = matchResult.parentJobSuggestions;

    timer.end("parent_job_matching", {
      matched: parentJobsAutoMatched,
      suggestions: parentJobSuggestions,
      skippedPreserved: matchResult.skipped,
      updated: matchResult.updated,
    });

    timer.start("item_suggestions");
    currentStage = "item_suggestions";
    timer.end("item_suggestions", { deferred: true, created: 0 });

    const needsAttention = await countNeedsAttention(adminClient);
    const ignored = await countIgnored(adminClient);

    const { count: confirmedLinksCount } = await adminClient
      .from("printfactory_job_manifest_items")
      .select("id", { count: "exact", head: true })
      .eq("link_status", "confirmed");

    if (context.onSuccessState) {
      await context.onSuccessState({
        recordsReceived,
        imported,
        updated,
        hasMore,
        nextCursor,
        windowCapped,
      });
    }

    const summaryMessage = buildSyncSummaryMessage({
      recordsReceived,
      imported,
      refreshed: updated,
      parentJobsAutoMatched,
      parentJobSuggestions,
      needsAttention,
      pagesFetched,
      hasMore,
      windowCapped,
      partial: false,
      failingStage: null,
      dateTimeFrom: request.dateTimeFrom,
      dateTimeTo: request.dateTimeTo,
    });

    return finish({
      ok: true,
      partial: false,
      itemSuggestions: 0,
      confirmedLinks: confirmedLinksCount ?? 0,
      needsAttention,
      ignored,
      errors: 0,
      itemSuggestionsCreated: 0,
      unmatched: needsAttention,
      failed: 0,
      summaryMessage,
      error: null,
      errorCode: null,
      safeMessage: null,
    });
  } catch (error) {
    return recordFailure(error, currentStage);
  }
}
