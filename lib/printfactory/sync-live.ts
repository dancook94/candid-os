import type { SupabaseClient } from "@supabase/supabase-js";

import { checkPrintfactorySchemaReadiness } from "@/lib/printfactory/schema-readiness";
import { getPrintfactoryConnectionStatus } from "@/lib/printfactory/client";
import {
  buildLiveSyncWindow,
  getPrintfactoryLiveSyncLimits,
} from "@/lib/printfactory/sync-config";
import {
  detectWindowCapped,
  runPrintfactorySyncBatch,
  type PrintfactorySyncResult,
} from "@/lib/printfactory/sync-engine";
import { acquireSyncLock, releaseSyncLock } from "@/lib/printfactory/sync-lock";
import {
  loadPrintfactorySyncState,
  savePrintfactorySyncState,
} from "@/lib/printfactory/sync-state";

export async function syncLivePrintfactoryJobs(
  adminClient: SupabaseClient,
  actorProfileId?: string | null
): Promise<PrintfactorySyncResult> {
  const connectionStatus = getPrintfactoryConnectionStatus();
  const liveLimits = getPrintfactoryLiveSyncLimits();
  const attemptedAt = new Date().toISOString();

  if (!connectionStatus.configured) {
    const message = `PrintFactory is not configured. Missing: ${connectionStatus.missing.join(", ")}`;

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
      elapsedMs: 0,
      failingStage: null,
      stageTimings: [],
      matched: 0,
      unmatched: 0,
      suggested: 0,
      failed: 0,
      itemSuggestionsCreated: 0,
      error: message,
      errorCode: "not_configured",
      safeMessage: message,
      connectionStatus,
      summaryMessage: null,
    };
  }

  const schemaReadiness = await checkPrintfactorySchemaReadiness(adminClient);

  if (!schemaReadiness.ready) {
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
      elapsedMs: 0,
      failingStage: null,
      stageTimings: [],
      matched: 0,
      unmatched: 0,
      suggested: 0,
      failed: 0,
      itemSuggestionsCreated: 0,
      error: schemaReadiness.message,
      safeMessage: schemaReadiness.message,
      errorCode: "migration_required",
      connectionStatus,
      summaryMessage: null,
    };
  }

  const lock = await acquireSyncLock(adminClient, "live");

  if (!lock.ok) {
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
      elapsedMs: 0,
      failingStage: null,
      stageTimings: [],
      matched: 0,
      unmatched: 0,
      suggested: 0,
      failed: 0,
      itemSuggestionsCreated: 0,
      error: lock.message,
      safeMessage: lock.message,
      errorCode: lock.errorCode,
      connectionStatus,
      summaryMessage: null,
    };
  }

  const syncState = await loadPrintfactorySyncState(adminClient);
  const dateWindow = buildLiveSyncWindow(liveLimits, new Date(), {
    includeHistorical: false,
  });

  await savePrintfactorySyncState(adminClient, {
    liveLastAttemptedAt: attemptedAt,
    liveLastError: null,
    lastAttemptedSyncAt: attemptedAt,
    lastError: null,
  });

  try {
    const result = await runPrintfactorySyncBatch({
      adminClient,
      actorProfileId,
      attemptedAt,
      request: {
        dateTimeFrom: dateWindow.dateTimeFrom,
        dateTimeTo: dateWindow.dateTimeTo,
        skip: 0,
        maxRecords: liveLimits.maxRecordsPerSync,
        maxPages: liveLimits.maxPagesPerSync,
        pageSize: liveLimits.pageSize,
        upsertBatchSize: liveLimits.upsertBatchSize,
        matchBatchSize: liveLimits.matchBatchSize,
      },
      onSuccessState: async ({
        recordsReceived,
        hasMore,
        nextCursor,
        windowCapped,
      }) => {
        const capped = windowCapped;
        const canAdvanceWatermark =
          recordsReceived === 0 || (!capped && !hasMore);

        await savePrintfactorySyncState(adminClient, {
          liveLastAttemptedAt: attemptedAt,
          liveLastError: null,
          liveWindowCapped: capped,
          liveLastSuccessfulAt: canAdvanceWatermark ? attemptedAt : syncState.liveLastSuccessfulAt,
          lastAttemptedSyncAt: attemptedAt,
          lastError: null,
          lastRecordCount: recordsReceived,
        });

        void nextCursor;
      },
      onFailureState: async ({ normalizedError, recordsReceived }) => {
        await savePrintfactorySyncState(adminClient, {
          liveLastAttemptedAt: attemptedAt,
          liveLastError: normalizedError.safeMessage,
          lastAttemptedSyncAt: attemptedAt,
          lastError: normalizedError.safeMessage,
          lastRecordCount: recordsReceived > 0 ? recordsReceived : null,
        });
      },
    });

    return result;
  } finally {
    await releaseSyncLock(adminClient);
  }
}

export async function syncPrintfactoryJobs(
  adminClient: SupabaseClient,
  actorProfileId?: string | null,
  _options: { includeHistorical?: boolean } = {}
): Promise<PrintfactorySyncResult> {
  void _options;
  return syncLivePrintfactoryJobs(adminClient, actorProfileId);
}
