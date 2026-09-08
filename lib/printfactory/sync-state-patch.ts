import type { PrintfactorySyncState } from "@/lib/printfactory/sync-state";

export type PrintfactorySyncStatePatch = Partial<PrintfactorySyncState> & {
  lastError?: string | null;
  liveLastError?: string | null;
};

export function buildPrintfactorySyncStateRow(
  update: PrintfactorySyncStatePatch,
  now = new Date().toISOString()
) {
  const row: Record<string, unknown> = {
    singleton_key: "default",
    updated_at: now,
  };

  const assign = (
    key: keyof PrintfactorySyncStatePatch,
    column: string,
    transform: (value: unknown) => unknown = (value) => value
  ) => {
    if (key in update) {
      row[column] = transform(update[key]);
    }
  };

  assign("lastSuccessfulSyncAt", "last_successful_sync_at", (v) => v ?? null);
  assign("lastAttemptedSyncAt", "last_attempted_sync_at", (v) => v ?? null);
  assign("lastSkipCursor", "last_skip_cursor", (v) => v ?? 0);
  assign("lastRecordCount", "last_record_count", (v) => v ?? null);
  assign("lastError", "last_error", (v) => v ?? null);

  assign("liveLastSuccessfulAt", "live_last_successful_at", (v) => v ?? null);
  assign("liveLastAttemptedAt", "live_last_attempted_at", (v) => v ?? null);
  assign("liveLastError", "live_last_error", (v) => v ?? null);
  assign("liveWindowCapped", "live_window_capped", (v) => Boolean(v));

  assign("syncLockedUntil", "sync_locked_until", (v) => v ?? null);
  assign("syncLockMode", "sync_lock_mode", (v) => v ?? null);

  return row;
}
