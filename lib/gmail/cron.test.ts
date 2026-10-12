import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { cronAuthorizationMatches } from "@/lib/gmail/cron-auth";
import { runGmailDiscoveryCron } from "@/lib/gmail/cron";
import { GMAIL_ONGOING_SYNC_ENABLED } from "@/lib/gmail/config";
import { planOngoingDiscovery } from "@/lib/gmail/sync-plan";

const FORBIDDEN = ["supplier_invoices", "material_prices", "materials", "supplier_products"];

function cronAdmin(checkpoint: { enabled: boolean } | null) {
  const writes: string[] = [];

  return {
    writes,
    admin: {
      from(table: string) {
        if (FORBIDDEN.includes(table)) {
          throw new Error(`Unexpected access to ${table}`);
        }

        writes.push(table);
        const api = {
          select() {
            return api;
          },
          eq() {
            return api;
          },
          maybeSingle: async () => {
            if (table === "gmail_connections") {
              return { data: { id: "conn-1" }, error: null };
            }

            if (table === "gmail_sync_checkpoints") {
              return { data: checkpoint, error: null };
            }

            return { data: null, error: { message: "Missing discovery table." } };
          },
        };
        return api;
      },
    } as unknown as SupabaseClient,
  };
}

test("rejects unauthorised cron requests and accepts the configured secret", () => {
  const secret = "cron-secret";

  assert.equal(cronAuthorizationMatches(null, secret), false);
  assert.equal(cronAuthorizationMatches("Bearer wrong-secret", secret), false);
  assert.equal(cronAuthorizationMatches("Bearer cron-secret", ""), false);
  assert.equal(cronAuthorizationMatches("Bearer cron-secret", secret), true);
  assert.equal(GMAIL_ONGOING_SYNC_ENABLED, false);
});

test("a repeated cron invocation does not open another discovery", async () => {
  const memory = cronAdmin({ enabled: true });
  let calls = 0;
  const step = async () => {
    calls += 1;
    if (calls === 1) {
      return { status: "completed" as const };
    }

    throw new Error("There is no discovery to continue.");
  };

  const first = await runGmailDiscoveryCron({ admin: memory.admin, step, maxBatches: 4, budgetMs: 5_000 });
  const second = await runGmailDiscoveryCron({ admin: memory.admin, step, maxBatches: 4, budgetMs: 5_000 });

  assert.equal(first.status, "completed");
  assert.equal(first.batches, 1);
  assert.equal(second.status, "idle");
  assert.deepEqual(second.ongoing, { action: "skip", reason: "disabled" });
  assert.equal(memory.writes.some((table) => FORBIDDEN.includes(table)), false);
});

test("cron stops on a held lease, pause, rate limit, and an unfinished backfill", async () => {
  const paused = await runGmailDiscoveryCron({
    admin: cronAdmin(null).admin,
    maxBatches: 4,
    budgetMs: 5_000,
    step: async () => ({ status: "paused" }),
  });
  const limited = await runGmailDiscoveryCron({
    admin: cronAdmin(null).admin,
    maxBatches: 4,
    budgetMs: 5_000,
    step: async () => ({ status: "running", rateLimited: true, retryAfterSeconds: 12 }),
  });
  let batches = 0;
  const unfinished = await runGmailDiscoveryCron({
    admin: cronAdmin(null).admin,
    maxBatches: 3,
    budgetMs: 5_000,
    step: async () => {
      batches += 1;
      return { status: "running" as const };
    },
  });
  const busy = await runGmailDiscoveryCron({
    admin: cronAdmin(null).admin,
    maxBatches: 4,
    budgetMs: 5_000,
    step: async () => ({ status: "running" as const, busy: true }),
  });

  assert.equal(paused.status, "paused");
  assert.equal(paused.batches, 1);
  assert.equal(limited.rateLimited, true);
  assert.equal(limited.retryAfterSeconds, 12);
  assert.equal(limited.batches, 1);
  assert.equal(unfinished.status, "running");
  assert.equal(unfinished.batches, 3);
  assert.equal(batches, 3);
  assert.equal(busy.batches, 1);
  assert.equal(busy.status, "running");
});

test("ongoing discovery overlaps the previous checkpoint and refuses an active backfill", () => {
  const now = new Date("2026-10-12T18:00:00.000Z");
  const disabled = planOngoingDiscovery({
    enabled: false,
    backfillActive: false,
    now,
    scannedThrough: "2026-10-12T12:00:00.000Z",
  });
  const duringBackfill = planOngoingDiscovery({
    enabled: true,
    backfillActive: true,
    now,
    scannedThrough: "2026-10-12T12:00:00.000Z",
  });
  const window = planOngoingDiscovery({
    enabled: true,
    backfillActive: false,
    now,
    scannedThrough: "2026-10-12T12:00:00.000Z",
    overlapMinutes: 180,
  });

  assert.deepEqual(disabled, { action: "skip", reason: "disabled" });
  assert.deepEqual(duringBackfill, { action: "skip", reason: "backfill-active" });
  assert.equal(window.action, "scan");
  if (window.action === "scan") {
    assert.equal(window.afterEpoch, Date.parse("2026-10-12T09:00:00.000Z") / 1000);
    assert.equal(window.beforeEpoch, Date.parse("2026-10-12T18:00:00.000Z") / 1000);
    assert.equal(window.overlapMinutes, 180);
  }
});

test("the cron schedule is every 15 minutes and the worker does not start a sync run", async () => {
  const config = await readFile(new URL("../../vercel.json", import.meta.url), "utf8");
  const worker = await readFile(new URL("./cron.ts", import.meta.url), "utf8");
  const schedule = JSON.parse(config) as { crons: Array<{ path: string; schedule: string }> };

  assert.deepEqual(schedule.crons, [
    { path: "/api/cron/gmail-discovery", schedule: "*/15 * * * *" },
  ]);
  assert.doesNotMatch(worker, /startGmailDiscovery/);
  assert.doesNotMatch(worker, /from\("(supplier_invoices|material_prices|materials|supplier_products)"\)/);
});
