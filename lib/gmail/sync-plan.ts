import { GMAIL_SYNC_OVERLAP_MINUTES } from "@/lib/gmail/config";

export type OngoingDiscoveryDecision =
  | { action: "skip"; reason: "disabled" | "backfill-active" }
  | { action: "scan"; afterEpoch: number; beforeEpoch: number; overlapMinutes: number };

/**
 * Ongoing discovery stays off during Phase 1. The scan branch is the later
 * checkpoint design: reopen an overlap before the last checkpoint so a message
 * indexed late is not missed, and refuse to start while a backfill is active.
 */
export function planOngoingDiscovery(input: {
  enabled: boolean;
  backfillActive: boolean;
  now: Date;
  scannedThrough: string | null;
  overlapMinutes?: number;
}): OngoingDiscoveryDecision {
  if (!input.enabled) {
    return { action: "skip", reason: "disabled" };
  }

  if (input.backfillActive) {
    return { action: "skip", reason: "backfill-active" };
  }

  const overlapMinutes = input.overlapMinutes ?? GMAIL_SYNC_OVERLAP_MINUTES;
  const overlapMs = overlapMinutes * 60 * 1000;
  const through = input.scannedThrough
    ? new Date(input.scannedThrough).getTime()
    : input.now.getTime() - 24 * 60 * 60 * 1000;
  const after = Math.max(0, through - overlapMs);

  return {
    action: "scan",
    afterEpoch: Math.floor(after / 1000),
    beforeEpoch: Math.floor(input.now.getTime() / 1000),
    overlapMinutes,
  };
}
