import type { SupabaseClient } from "@supabase/supabase-js";

import {
  loadPrintfactorySyncState,
  savePrintfactorySyncState,
  type SyncLockMode,
} from "@/lib/printfactory/sync-state";

/** How long a sync holds the lock before it expires naturally. */
export const SYNC_LOCK_TTL_MS = 5 * 60 * 1000;

/** After this age, a held lock is treated as stale and may be taken over. */
export const SYNC_LOCK_STALE_MS = 15 * 60 * 1000;

export type SyncLockResult =
  | { ok: true }
  | { ok: false; message: string; errorCode: "sync_locked" };

function lockStartedAt(lockedUntil: string, nowMs: number): number {
  const untilMs = new Date(lockedUntil).getTime();

  if (!Number.isFinite(untilMs)) {
    return nowMs;
  }

  return untilMs - SYNC_LOCK_TTL_MS;
}

export function isSyncLockActive(
  syncLockedUntil: string | null,
  now = new Date()
): boolean {
  if (!syncLockedUntil) {
    return false;
  }

  const untilMs = new Date(syncLockedUntil).getTime();

  if (!Number.isFinite(untilMs) || untilMs <= now.getTime()) {
    return false;
  }

  const startedMs = lockStartedAt(syncLockedUntil, now.getTime());

  return now.getTime() - startedMs < SYNC_LOCK_STALE_MS;
}

export async function acquireSyncLock(
  adminClient: SupabaseClient,
  mode: SyncLockMode,
  now = new Date()
): Promise<SyncLockResult> {
  const state = await loadPrintfactorySyncState(adminClient);

  if (state.syncLockedUntil && isSyncLockActive(state.syncLockedUntil, now)) {
    return {
      ok: false,
      message: "PrintFactory sync is already running. Try again shortly.",
      errorCode: "sync_locked",
    };
  }

  await savePrintfactorySyncState(adminClient, {
    syncLockedUntil: new Date(now.getTime() + SYNC_LOCK_TTL_MS).toISOString(),
    syncLockMode: mode,
  });

  return { ok: true };
}

export async function releaseSyncLock(adminClient: SupabaseClient) {
  await savePrintfactorySyncState(adminClient, {
    syncLockedUntil: null,
    syncLockMode: null,
  });
}
