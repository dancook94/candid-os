import type { PrintfactorySyncState } from "@/lib/printfactory/sync-state";

export type PrintfactorySyncStatePatch = Partial<PrintfactorySyncState> & {
  lastError?: string | null;
};

export function buildPrintfactorySyncStateRow(
  update: PrintfactorySyncStatePatch,
  now = new Date().toISOString()
) {
  const row: Record<string, unknown> = {
    singleton_key: "default",
    updated_at: now,
  };

  if ("lastSuccessfulSyncAt" in update) {
    row.last_successful_sync_at = update.lastSuccessfulSyncAt ?? null;
  }

  if ("lastAttemptedSyncAt" in update) {
    row.last_attempted_sync_at = update.lastAttemptedSyncAt ?? now;
  }

  if ("lastSkipCursor" in update) {
    row.last_skip_cursor = update.lastSkipCursor ?? 0;
  }

  if ("lastRecordCount" in update) {
    row.last_record_count = update.lastRecordCount ?? null;
  }

  if ("lastError" in update) {
    row.last_error = update.lastError ?? null;
  }

  return row;
}
