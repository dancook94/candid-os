import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_noStore as noStore } from "next/cache";

import {
  fetchPrintfactoryJobsBounded,
  getPrintfactoryConnectionStatus,
} from "@/lib/printfactory/client";
import {
  PRINTFACTORY_ACTIVITY_TYPES,
  PRINTFACTORY_JOB_SELECT,
} from "@/lib/printfactory/constants";
import { PrintfactoryError } from "@/lib/printfactory/errors";
import { logPrintfactoryActivity } from "@/lib/printfactory/activity";
import {
  countPrintfactoryRecordsByTab,
  filterPrintfactoryRecordsByTab,
  type ExceptionQueueTab,
} from "@/lib/printfactory/matching-queue";
import {
  checkPrintfactorySchemaReadiness,
  logMatchingDataQueryDev,
  toPrintfactoryDataQueryError,
  type PrintfactoryDataQueryError,
} from "@/lib/printfactory/schema-readiness";
import {
  buildIncrementalSyncWindow,
  buildInitialSyncWindow,
  getPrintfactorySyncLimits,
} from "@/lib/printfactory/sync-config";
import {
  batchMatchPrintfactoryJobs,
  batchUpsertPrintfactoryJobs,
  loadExistingPrintfactoryRows,
} from "@/lib/printfactory/sync-processor";
import {
  loadPrintfactorySyncState,
  savePrintfactorySyncState,
} from "@/lib/printfactory/sync-state";
import {
  createSyncStageTimer,
  type SyncStageName,
  type SyncStageTiming,
} from "@/lib/printfactory/sync-timing";

export type PrintfactorySyncResult = {
  ok: boolean;
  partial: boolean;
  imported: number;
  updated: number;
  alreadyCurrent: number;
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
  elapsedMs: number;
  failingStage: SyncStageName | null;
  stageTimings: SyncStageTiming[];
  /** @deprecated use parentJobsAutoMatched */
  matched: number;
  /** @deprecated use needsAttention */
  unmatched: number;
  /** @deprecated use parentJobSuggestions */
  suggested: number;
  /** @deprecated use errors */
  failed: number;
  /** @deprecated use itemSuggestions */
  itemSuggestionsCreated: number;
  error: string | null;
  errorCode: string | null;
  connectionStatus: ReturnType<typeof getPrintfactoryConnectionStatus>;
  summaryMessage: string | null;
};

function buildSyncSummaryMessage(stats: {
  recordsReceived: number;
  imported: number;
  alreadyCurrent: number;
  parentJobsAutoMatched: number;
  parentJobSuggestions: number;
  needsAttention: number;
  pagesFetched: number;
  hasMore: boolean;
  partial: boolean;
  failingStage: SyncStageName | null;
  committedImported: number;
  committedUpdated: number;
}) {
  if (stats.recordsReceived === 0) {
    return "No PrintFactory jobs returned in the sync window.";
  }

  const lines = [
    stats.partial && stats.failingStage
      ? `Sync partially completed (${stats.failingStage} failed after commit).`
      : "Sync complete:",
    `- ${stats.recordsReceived} record${stats.recordsReceived === 1 ? "" : "s"} received`,
    `- ${stats.imported} imported`,
    `- ${stats.alreadyCurrent} already current`,
    `- ${stats.parentJobsAutoMatched} job${stats.parentJobsAutoMatched === 1 ? "" : "s"} matched automatically`,
    `- ${stats.needsAttention} need${stats.needsAttention === 1 ? "s" : ""} attention`,
    `- ${stats.pagesFetched} page${stats.pagesFetched === 1 ? "" : "s"} fetched`,
    `- More records available: ${stats.hasMore ? "Yes" : "No"}`,
  ];

  if (stats.partial && stats.failingStage) {
    lines.push(
      `- Imported ${stats.committedImported + stats.committedUpdated} PrintFactory job${stats.committedImported + stats.committedUpdated === 1 ? "" : "s"} before failure; those records were retained.`
    );
  } else if (stats.hasMore) {
    lines.push(
      "Imported the newest batch of PrintFactory jobs. Run sync again to continue."
    );
  }

  if (stats.parentJobSuggestions > 0) {
    lines.splice(
      5,
      0,
      `- ${stats.parentJobSuggestions} suggested match${stats.parentJobSuggestions === 1 ? "" : "es"}`
    );
  }

  return lines.join("\n");
}

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

export async function syncPrintfactoryJobs(
  adminClient: SupabaseClient,
  actorProfileId?: string | null
): Promise<PrintfactorySyncResult> {
  const connectionStatus = getPrintfactoryConnectionStatus();
  const limits = getPrintfactorySyncLimits();
  const timer = createSyncStageTimer();
  const attemptedAt = new Date().toISOString();

  const emptyResult = (
    partial: Partial<PrintfactorySyncResult> = {}
  ): PrintfactorySyncResult => ({
    ok: false,
    partial: false,
    imported: 0,
    updated: 0,
    alreadyCurrent: 0,
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
    connectionStatus,
    summaryMessage: null,
    ...partial,
  });

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

  const finish = (
    partial: Partial<PrintfactorySyncResult>
  ): PrintfactorySyncResult => {
    const alreadyCurrent = Math.max(recordsReceived - imported, 0);
    const stageTimings = timer.getTimings();
    const elapsedMs =
      stageTimings.find((entry) => entry.stage === "total")?.elapsedMs ?? 0;

    timer.logDevSummary({
      imported,
      updated,
      recordsReceived,
      pagesFetched,
      hasMore,
      failingStage,
    });

    return emptyResult({
      imported,
      updated,
      alreadyCurrent,
      parentJobsAutoMatched,
      parentJobSuggestions,
      pagesFetched,
      recordsReceived,
      recordsProcessed: recordsReceived,
      accountTotal,
      filteredTotal,
      hasMore,
      nextCursor,
      elapsedMs,
      failingStage,
      stageTimings,
      matched: parentJobsAutoMatched,
      suggested: parentJobSuggestions,
      ...partial,
    });
  };

  if (!connectionStatus.configured) {
    return finish({
      error: `PrintFactory is not configured. Missing: ${connectionStatus.missing.join(", ")}`,
      errorCode: "not_configured",
    });
  }

  const schemaReadiness = await checkPrintfactorySchemaReadiness(adminClient);

  if (!schemaReadiness.ready) {
    return finish({
      error: schemaReadiness.message,
      errorCode: "migration_required",
    });
  }

  const syncState = await loadPrintfactorySyncState(adminClient);
  const continuingBackfill = syncState.lastSkipCursor > 0 && !syncState.lastSuccessfulSyncAt;

  const dateWindow = syncState.lastSuccessfulSyncAt
    ? buildIncrementalSyncWindow(syncState.lastSuccessfulSyncAt, limits)
    : buildInitialSyncWindow(limits);

  await savePrintfactorySyncState(adminClient, {
    lastAttemptedSyncAt: attemptedAt,
    lastError: null,
  });

  try {
    timer.start("api_request");
    currentStage = "api_request";
    timer.start("pagination");

    const fetchResult = await fetchPrintfactoryJobsBounded({
      skip: continuingBackfill ? syncState.lastSkipCursor : 0,
      dateTimeFrom: dateWindow.dateTimeFrom,
      dateTimeTo: dateWindow.dateTimeTo,
      maxRecords: limits.maxRecordsPerSync,
      maxPages: limits.maxPagesPerSync,
      pageSize: limits.pageSize,
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

    if (fetchResult.jobs.length === 0) {
      await savePrintfactorySyncState(adminClient, {
        lastAttemptedSyncAt: attemptedAt,
        lastSuccessfulSyncAt: attemptedAt,
        lastSkipCursor: 0,
        lastRecordCount: 0,
        lastError: null,
      });

      return finish({
        ok: true,
        summaryMessage: buildSyncSummaryMessage({
          recordsReceived: 0,
          imported: 0,
          alreadyCurrent: 0,
          parentJobsAutoMatched: 0,
          parentJobSuggestions: 0,
          needsAttention: 0,
          pagesFetched,
          hasMore: false,
          partial: false,
          failingStage: null,
          committedImported: 0,
          committedUpdated: 0,
        }),
      });
    }

    const now = new Date().toISOString();

    timer.start("normalization");
    currentStage = "normalization";
    timer.end("normalization", {
      recordsReceived: fetchResult.jobs.length,
    });

    timer.start("database_upsert");
    currentStage = "database_upsert";

    const existingByGuid = await loadExistingPrintfactoryRows(
      adminClient,
      fetchResult.jobs.map((job) => job.guid)
    );

    const upsertResult = await batchUpsertPrintfactoryJobs(
      adminClient,
      fetchResult.jobs,
      existingByGuid,
      now,
      limits.upsertBatchSize
    );

    imported = upsertResult.imported;
    updated = upsertResult.updated;

    timer.end("database_upsert", {
      imported,
      updated,
      batchSize: limits.upsertBatchSize,
    });

    timer.start("parent_job_matching");
    currentStage = "parent_job_matching";

    const matchResult = await batchMatchPrintfactoryJobs(
      adminClient,
      Array.from(upsertResult.rowByGuid.values()),
      limits.matchBatchSize
    );

    parentJobsAutoMatched = matchResult.parentJobsAutoMatched;
    parentJobSuggestions = matchResult.parentJobSuggestions;

    timer.end("parent_job_matching", {
      matched: parentJobsAutoMatched,
      suggestions: parentJobSuggestions,
      skippedPreserved: matchResult.skipped,
      updated: matchResult.updated,
    });

    // Item suggestions and per-job readiness refresh are deferred to keep sync under route timeout.
    timer.start("item_suggestions");
    currentStage = "item_suggestions";
    timer.end("item_suggestions", { deferred: true, created: 0 });

    const needsAttention = await countNeedsAttention(adminClient);
    const ignored = await countIgnored(adminClient);

    const { count: confirmedLinksCount } = await adminClient
      .from("printfactory_job_manifest_items")
      .select("id", { count: "exact", head: true })
      .eq("link_status", "confirmed");

    const summaryMessage = buildSyncSummaryMessage({
      recordsReceived,
      imported,
      alreadyCurrent: Math.max(recordsReceived - imported, 0),
      parentJobsAutoMatched,
      parentJobSuggestions,
      needsAttention,
      pagesFetched,
      hasMore,
      partial: false,
      failingStage: null,
      committedImported: imported,
      committedUpdated: updated,
    });

    timer.start("activity_logging");
    currentStage = "activity_logging";

    await logPrintfactoryActivity(adminClient, {
      activityType: PRINTFACTORY_ACTIVITY_TYPES.syncCompleted,
      description: summaryMessage.replace(/\n/g, " "),
      actorProfileId,
      metadata: {
        imported,
        updated,
        parentJobsAutoMatched,
        parentJobSuggestions,
        itemSuggestions: 0,
        confirmedLinks: confirmedLinksCount ?? 0,
        needsAttention,
        ignored,
        errors: 0,
        pagesFetched,
        recordsReceived,
        hasMore,
        nextCursor,
        accountTotal,
        filteredTotal,
        elapsedMs: timer.getTimings().find((entry) => entry.stage === "total")?.elapsedMs ?? 0,
      },
    });

    timer.end("activity_logging");

    await savePrintfactorySyncState(adminClient, {
      lastAttemptedSyncAt: attemptedAt,
      lastSuccessfulSyncAt: hasMore ? syncState.lastSuccessfulSyncAt : attemptedAt,
      lastSkipCursor: hasMore ? (nextCursor ?? syncState.lastSkipCursor) : 0,
      lastRecordCount: recordsReceived,
      lastError: null,
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
    });
  } catch (error) {
    failingStage = currentStage;

    const safeMessage =
      error instanceof PrintfactoryError
        ? error.message
        : error instanceof Error
          ? error.message
          : "PrintFactory sync failed.";

    const partialSuccess = imported + updated > 0;
    const committedMessage = partialSuccess
      ? `Imported ${imported + updated} PrintFactory jobs, but ${failingStage?.replace(/_/g, " ")} failed. Imported records were retained.`
      : safeMessage;

    await savePrintfactorySyncState(adminClient, {
      lastAttemptedSyncAt: attemptedAt,
      lastSkipCursor: hasMore ? (nextCursor ?? syncState.lastSkipCursor) : syncState.lastSkipCursor,
      lastRecordCount: recordsReceived || null,
      lastError: safeMessage,
      ...(partialSuccess && !hasMore
        ? { lastSuccessfulSyncAt: syncState.lastSuccessfulSyncAt }
        : {}),
    });

    if (error instanceof PrintfactoryError) {
      return finish({
        ok: partialSuccess,
        partial: partialSuccess,
        failingStage,
        error: committedMessage,
        errorCode: error.code,
        summaryMessage: partialSuccess ? committedMessage : null,
      });
    }

    const schemaReadinessAfter = await checkPrintfactorySchemaReadiness(adminClient);

    if (!schemaReadinessAfter.ready) {
      return finish({
        partial: partialSuccess,
        failingStage,
        error: schemaReadinessAfter.message ?? "PrintFactory matching schema is not ready.",
        errorCode: "migration_required",
      });
    }

    return finish({
      ok: partialSuccess,
      partial: partialSuccess,
      failingStage,
      error: committedMessage,
      errorCode: "sync_failed",
      summaryMessage: partialSuccess ? committedMessage : null,
    });
  }
}

export async function loadPrintfactoryMatchingRecords(
  adminClient: SupabaseClient,
  tab: ExceptionQueueTab
) {
  if (process.env.NODE_ENV === "development") {
    noStore();
  }

  const schemaReadiness = await checkPrintfactorySchemaReadiness(adminClient);

  if (!schemaReadiness.ready) {
    return {
      records: [],
      schemaMissing: true as const,
      schemaMissingMessage: schemaReadiness.message,
      dataQueryError: null as PrintfactoryDataQueryError | null,
      tabCounts: null,
    };
  }

  const { data, error } = await adminClient
    .from("printfactory_jobs")
    .select(`
    ${PRINTFACTORY_JOB_SELECT},
    jobs:jobs!printfactory_jobs_candid_job_id_fkey(
      id, job_reference, project_name, company_id, companies(company_name)
    ),
    printfactory_job_manifest_items(
      id, production_item_id, link_status, match_method, match_confidence,
      suggestion_reason, suggestion_details, confirmed_at,
      production_items(id, item_reference, item_name)
    )
  `)
    .order("last_seen_at", { ascending: false })
    .limit(500);

  if (error) {
    const dataQueryError = toPrintfactoryDataQueryError(error);
    logMatchingDataQueryDev(dataQueryError);

    return {
      records: [],
      schemaMissing: false as const,
      schemaMissingMessage: null,
      dataQueryError,
      tabCounts: null,
    };
  }

  const allRecords = data ?? [];
  const tabCounts = countPrintfactoryRecordsByTab(allRecords);
  const records = filterPrintfactoryRecordsByTab(allRecords, tab);

  return {
    records,
    schemaMissing: false as const,
    schemaMissingMessage: null,
    dataQueryError: null as PrintfactoryDataQueryError | null,
    tabCounts,
  };
}
