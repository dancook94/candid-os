import type { SupabaseClient } from "@supabase/supabase-js";

import { isSyncLockActive } from "@/lib/printfactory/sync-lock";
import { loadPrintfactorySyncState } from "@/lib/printfactory/sync-state";

export type PrintfactorySyncHealth = {
  liveLastSuccessfulAt: string | null;
  liveLastAttemptedAt: string | null;
  liveLastError: string | null;
  liveWindowCapped: boolean;
  liveDelayed: boolean;
  liveDelayMinutes: number | null;
  syncLocked: boolean;
  syncLockMode: string | null;
  schemaExtended: boolean;
};

/** Minutes after which live sync is considered delayed. */
export const LIVE_SYNC_DELAY_THRESHOLD_MINUTES = 15;

export function computeLiveDelayMinutes(
  liveLastSuccessfulAt: string | null,
  now = new Date()
): number | null {
  if (!liveLastSuccessfulAt) {
    return null;
  }

  const lastMs = new Date(liveLastSuccessfulAt).getTime();

  if (!Number.isFinite(lastMs)) {
    return null;
  }

  return Math.max(0, Math.floor((now.getTime() - lastMs) / 60_000));
}

export function isLiveSyncDelayed(
  liveLastSuccessfulAt: string | null,
  thresholdMinutes = LIVE_SYNC_DELAY_THRESHOLD_MINUTES,
  now = new Date()
): boolean {
  const delayMinutes = computeLiveDelayMinutes(liveLastSuccessfulAt, now);

  if (delayMinutes == null) {
    return false;
  }

  return delayMinutes >= thresholdMinutes;
}

export async function loadPrintfactorySyncHealth(
  adminClient: SupabaseClient,
  now = new Date()
): Promise<PrintfactorySyncHealth> {
  const state = await loadPrintfactorySyncState(adminClient);
  const delayMinutes = computeLiveDelayMinutes(state.liveLastSuccessfulAt, now);

  return {
    liveLastSuccessfulAt: state.liveLastSuccessfulAt,
    liveLastAttemptedAt: state.liveLastAttemptedAt,
    liveLastError: state.liveLastError,
    liveWindowCapped: state.liveWindowCapped,
    liveDelayed: isLiveSyncDelayed(state.liveLastSuccessfulAt, LIVE_SYNC_DELAY_THRESHOLD_MINUTES, now),
    liveDelayMinutes: delayMinutes,
    syncLocked: isSyncLockActive(state.syncLockedUntil, now),
    syncLockMode: state.syncLockMode,
    schemaExtended: state.schemaExtended,
  };
}

export function formatLiveSyncHealthLabel(health: PrintfactorySyncHealth, now = new Date()): string {
  if (health.liveLastError && !health.liveLastSuccessfulAt) {
    return "Live sync error — check logs";
  }

  if (health.liveDelayed) {
    const minutes = health.liveDelayMinutes ?? LIVE_SYNC_DELAY_THRESHOLD_MINUTES;
    return `Live sync delayed — last success ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }

  if (!health.liveLastSuccessfulAt) {
    return "Live sync not completed yet";
  }

  const minutes = computeLiveDelayMinutes(health.liveLastSuccessfulAt, now) ?? 0;

  if (minutes <= 1) {
    return "Live sync successful just now";
  }

  return `Live sync successful ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
}
