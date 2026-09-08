export const PRINTFACTORY_SYNC_DEFAULTS = {
  syncWindowDays: 30,
  maxRecordsPerSync: 500,
  maxPagesPerSync: 5,
  pageSize: 100,
  incrementalOverlapMinutes: 5,
  upsertBatchSize: 100,
  matchBatchSize: 100,
} as const;

export type PrintfactorySyncLimits = {
  syncWindowDays: number;
  maxRecordsPerSync: number;
  maxPagesPerSync: number;
  pageSize: number;
  incrementalOverlapMinutes: number;
  upsertBatchSize: number;
  matchBatchSize: number;
};

function readPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getPrintfactorySyncLimits(): PrintfactorySyncLimits {
  return {
    syncWindowDays: readPositiveInt(
      process.env.PRINTFACTORY_SYNC_DAYS,
      PRINTFACTORY_SYNC_DEFAULTS.syncWindowDays
    ),
    maxRecordsPerSync: readPositiveInt(
      process.env.PRINTFACTORY_SYNC_MAX_RECORDS,
      PRINTFACTORY_SYNC_DEFAULTS.maxRecordsPerSync
    ),
    maxPagesPerSync: readPositiveInt(
      process.env.PRINTFACTORY_SYNC_MAX_PAGES,
      PRINTFACTORY_SYNC_DEFAULTS.maxPagesPerSync
    ),
    pageSize: readPositiveInt(
      process.env.PRINTFACTORY_SYNC_PAGE_SIZE,
      PRINTFACTORY_SYNC_DEFAULTS.pageSize
    ),
    incrementalOverlapMinutes: readPositiveInt(
      process.env.PRINTFACTORY_SYNC_OVERLAP_MINUTES,
      PRINTFACTORY_SYNC_DEFAULTS.incrementalOverlapMinutes
    ),
    upsertBatchSize: PRINTFACTORY_SYNC_DEFAULTS.upsertBatchSize,
    matchBatchSize: PRINTFACTORY_SYNC_DEFAULTS.matchBatchSize,
  };
}

import { clampSyncDateTimeFrom } from "@/lib/printfactory/matching-config";

export type SyncWindowOptions = {
  includeHistorical?: boolean;
};

export function buildInitialSyncWindow(
  limits: PrintfactorySyncLimits,
  now = new Date(),
  options?: SyncWindowOptions
) {
  const dateTimeTo = now.toISOString();
  const dateTimeFrom = new Date(now);
  dateTimeFrom.setDate(dateTimeFrom.getDate() - limits.syncWindowDays);

  return {
    dateTimeFrom: clampSyncDateTimeFrom(dateTimeFrom.toISOString(), options),
    dateTimeTo,
  };
}

export function buildIncrementalSyncWindow(
  lastSuccessfulSyncAt: string,
  limits: PrintfactorySyncLimits,
  now = new Date(),
  options?: SyncWindowOptions
) {
  const overlapMs = limits.incrementalOverlapMinutes * 60 * 1000;
  const from = new Date(lastSuccessfulSyncAt);
  from.setTime(from.getTime() - overlapMs);

  return {
    dateTimeFrom: clampSyncDateTimeFrom(from.toISOString(), options),
    dateTimeTo: now.toISOString(),
  };
}
