import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { shouldPreserveExistingJobMatch } from "@/lib/printfactory/job-matching";
import {
  filterPrintfactoryRecordsByOperationalWindow,
  getPrintfactoryMatchingGoLiveIso,
  isPrintfactoryRecordOnOrAfterGoLive,
} from "@/lib/printfactory/matching-config";
import {
  buildLiveSyncWindow,
  getPrintfactoryLiveSyncLimits,
  PRINTFACTORY_SYNC_DEFAULTS,
} from "@/lib/printfactory/sync-config";
import { detectWindowCapped } from "@/lib/printfactory/sync-engine";
import {
  acquireSyncLock,
  isSyncLockActive,
  releaseSyncLock,
  SYNC_LOCK_STALE_MS,
  SYNC_LOCK_TTL_MS,
} from "@/lib/printfactory/sync-lock";
import { buildSyncSummaryMessage } from "@/lib/printfactory/sync-summary";
import {
  computeLiveDelayMinutes,
  formatLiveSyncHealthLabel,
  isLiveSyncDelayed,
} from "@/lib/printfactory/sync-health";
import { buildPrintfactorySyncStateRow } from "@/lib/printfactory/sync-state-patch";

function shouldAdvanceLiveWatermark(input: {
  recordsReceived: number;
  windowCapped: boolean;
  hasMore: boolean;
}): boolean {
  return input.recordsReceived === 0 || (!input.windowCapped && !input.hasMore);
}

function emptySyncStateRow(): Record<string, unknown> {
  return {
    singleton_key: "default",
    last_successful_sync_at: "2026-09-03T14:14:25.719Z",
    last_attempted_sync_at: "2026-09-08T15:06:06.000Z",
    last_skip_cursor: 500,
    last_record_count: 500,
    last_error: null,
    live_last_successful_at: null,
    live_last_attempted_at: null,
    live_last_error: null,
    live_window_capped: false,
    sync_locked_until: null,
    sync_lock_mode: null,
  };
}

function createMockAdminClient(initialRow: Record<string, unknown> = emptySyncStateRow()) {
  let row = { ...initialRow };

  const adminClient = {
    from: (_table: string) => ({
      select: (_columns: string) => ({
        eq: (_column: string, _value: string) => ({
          maybeSingle: async () => ({ data: row, error: null }),
        }),
      }),
      upsert: async (patch: Record<string, unknown>) => {
        row = { ...row, ...patch };
        return { error: null };
      },
    }),
  };

  return {
    adminClient: adminClient as never,
    getRow: () => row,
  };
}

describe("live-only PrintFactory sync", () => {
  it("uses a narrow rolling recent window with overlap", () => {
    const now = new Date("2026-09-08T15:00:00.000Z");
    const limits = getPrintfactoryLiveSyncLimits();
    const window = buildLiveSyncWindow(limits, now);

    const fromMs = new Date(window.dateTimeFrom).getTime();
    const expectedFromMs = now.getTime() - (limits.windowMinutes + limits.overlapMinutes) * 60 * 1000;

    assert.equal(window.dateTimeTo, now.toISOString());
    assert.equal(fromMs, expectedFromMs);
    assert.equal(limits.windowMinutes, PRINTFACTORY_SYNC_DEFAULTS.liveWindowMinutes);
  });

  it("clamps live window lower bound to operational go-live date", () => {
    const goLive = getPrintfactoryMatchingGoLiveIso();
    const now = new Date("2026-09-08T15:00:00.000Z");
    const window = buildLiveSyncWindow(getPrintfactoryLiveSyncLimits(), now);

    assert.ok(new Date(window.dateTimeFrom).getTime() >= new Date(goLive).getTime());
  });

  it("never uses legacy last_skip_cursor or Sept 3 watermark for live state reads", () => {
    const row = buildPrintfactorySyncStateRow({
      liveLastAttemptedAt: "2026-09-08T15:00:00.000Z",
    });

    assert.equal("last_skip_cursor" in row, false);
    assert.equal("live_last_successful_at" in row, false);
  });

  it("does not advance live watermark when window is capped", () => {
    const capped = detectWindowCapped({
      recordsReceived: 100,
      maxRecords: 100,
      hasMore: false,
      filteredTotal: 250,
    });

    assert.equal(capped, true);
    assert.equal(
      shouldAdvanceLiveWatermark({ recordsReceived: 100, windowCapped: capped, hasMore: false }),
      false
    );
  });

  it("reports capped live sync without implying caught-up", () => {
    const summary = buildSyncSummaryMessage({
      recordsReceived: 100,
      imported: 0,
      refreshed: 100,
      parentJobsAutoMatched: 0,
      parentJobSuggestions: 0,
      needsAttention: 0,
      pagesFetched: 2,
      hasMore: true,
      windowCapped: true,
      partial: false,
      failingStage: null,
      dateTimeFrom: "2026-09-08T14:00:00.000Z",
      dateTimeTo: "2026-09-08T15:00:00.000Z",
    });

    assert.match(summary, /0 new jobs imported/);
    assert.match(summary, /Live window capped/);
    assert.doesNotMatch(summary, /already current/i);
  });
});

describe("operational cutover exclusion", () => {
  const cutover = "2026-09-08";

  it("excludes records before cutover from the operational window", () => {
    const records = [
      { created_at_printfactory: "2026-09-03T10:00:00.000Z", first_seen_at: "2026-09-03T10:00:00.000Z" },
      { created_at_printfactory: "2026-09-08T12:00:00.000Z", first_seen_at: "2026-09-08T12:00:00.000Z" },
    ];

    const original = process.env.PRINTFACTORY_MATCHING_GO_LIVE_DATE;
    process.env.PRINTFACTORY_MATCHING_GO_LIVE_DATE = cutover;

    try {
      const operational = filterPrintfactoryRecordsByOperationalWindow(records, {});
      assert.equal(operational.length, 1);
      assert.equal(isPrintfactoryRecordOnOrAfterGoLive(records[0]), false);
      assert.equal(isPrintfactoryRecordOnOrAfterGoLive(records[1]), true);
    } finally {
      if (original === undefined) {
        delete process.env.PRINTFACTORY_MATCHING_GO_LIVE_DATE;
      } else {
        process.env.PRINTFACTORY_MATCHING_GO_LIVE_DATE = original;
      }
    }
  });

  it("still allows viewing pre-cutover records when includeHistorical is enabled", () => {
    const records = [
      { created_at_printfactory: "2026-09-03T10:00:00.000Z", first_seen_at: "2026-09-03T10:00:00.000Z" },
      { created_at_printfactory: "2026-09-08T12:00:00.000Z", first_seen_at: "2026-09-08T12:00:00.000Z" },
    ];

    const original = process.env.PRINTFACTORY_MATCHING_GO_LIVE_DATE;
    process.env.PRINTFACTORY_MATCHING_GO_LIVE_DATE = cutover;

    try {
      const all = filterPrintfactoryRecordsByOperationalWindow(records, {
        includeHistorical: true,
      });
      assert.equal(all.length, 2);
    } finally {
      if (original === undefined) {
        delete process.env.PRINTFACTORY_MATCHING_GO_LIVE_DATE;
      } else {
        process.env.PRINTFACTORY_MATCHING_GO_LIVE_DATE = original;
      }
    }
  });
});

describe("matching preservation", () => {
  it("preserves manual and ignored job match statuses during sync matching", () => {
    assert.equal(shouldPreserveExistingJobMatch("matched_manually"), true);
    assert.equal(shouldPreserveExistingJobMatch("ignored"), true);
    assert.equal(shouldPreserveExistingJobMatch("unmatched"), false);
  });
});

describe("sync concurrency lock", () => {
  it("blocks overlapping live sync while lock is active", async () => {
    const now = new Date("2026-09-08T15:00:00.000Z");
    const lockedUntil = new Date(now.getTime() + SYNC_LOCK_TTL_MS).toISOString();
    const { adminClient } = createMockAdminClient({
      ...emptySyncStateRow(),
      sync_locked_until: lockedUntil,
      sync_lock_mode: "live",
    });

    assert.equal(isSyncLockActive(lockedUntil, now), true);

    const second = await acquireSyncLock(adminClient, "live", now);
    assert.equal(second.ok, false);
  });

  it("allows takeover after stale lock exceeds recovery threshold", async () => {
    const now = new Date("2026-09-08T15:30:00.000Z");
    const staleLockedUntil = new Date(now.getTime() - SYNC_LOCK_STALE_MS).toISOString();
    const { adminClient, getRow } = createMockAdminClient({
      ...emptySyncStateRow(),
      sync_locked_until: staleLockedUntil,
      sync_lock_mode: "live",
    });

    const acquired = await acquireSyncLock(adminClient, "live", now);
    assert.equal(acquired.ok, true);
    assert.equal(getRow().sync_lock_mode, "live");
  });

  it("releases lock after failure path finally block", async () => {
    const now = new Date("2026-09-08T15:00:00.000Z");
    const { adminClient, getRow } = createMockAdminClient({
      ...emptySyncStateRow(),
      sync_locked_until: new Date(now.getTime() + SYNC_LOCK_TTL_MS).toISOString(),
      sync_lock_mode: "live",
    });

    await releaseSyncLock(adminClient);

    assert.equal(getRow().sync_locked_until, null);
    assert.equal(getRow().sync_lock_mode, null);
  });
});

describe("sync health", () => {
  it("marks live sync delayed after threshold", () => {
    const now = new Date("2026-09-08T16:00:00.000Z");
    const lastSuccess = new Date(now.getTime() - 18 * 60 * 1000).toISOString();

    assert.equal(isLiveSyncDelayed(lastSuccess, 15, now), true);
    assert.equal(computeLiveDelayMinutes(lastSuccess, now), 18);
  });

  it("formats live sync health without backfill status", () => {
    const label = formatLiveSyncHealthLabel(
      {
        liveLastSuccessfulAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
        liveLastAttemptedAt: null,
        liveLastError: null,
        liveWindowCapped: false,
        liveDelayed: false,
        liveDelayMinutes: 2,
        syncLocked: false,
        syncLockMode: null,
        schemaExtended: true,
      },
      new Date()
    );

    assert.match(label, /Live sync successful/i);
  });
});

describe("backfill removal", () => {
  it("does not ship a backfill API route", () => {
    const routePath = join(
      process.cwd(),
      "app/api/admin/printfactory/backfill/route.ts"
    );
    assert.equal(existsSync(routePath), false);
  });

  it("does not ship a backfill sync module", () => {
    const modulePath = join(process.cwd(), "lib/printfactory/sync-backfill.ts");
    assert.equal(existsSync(modulePath), false);
  });
});
