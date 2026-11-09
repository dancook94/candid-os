import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildStaffLeaveCalendarOutboxClaimFilter,
  isStaleStaffLeaveCalendarOutboxLock,
} from "@/lib/staff-leave/calendar-sync/process-outbox";
import { sortCalendarSyncOutboxRows } from "@/lib/staff-leave/calendar-sync/outbox-order";

const WORKER_MIGRATION = new URL(
  "../../../supabase/migrations/20270110159000_staff_leave_calendar_sync_worker.sql",
  import.meta.url
);

const CLAIM_ONE_PER_ENTITY_MIGRATION = new URL(
  "../../../supabase/migrations/20270110162000_staff_leave_calendar_claim_one_per_entity.sql",
  import.meta.url
);

test("worker migration defines atomic claim RPC and reconcile source kinds", async () => {
  const sql = await readFile(WORKER_MIGRATION, "utf8");

  assert.match(sql, /staff_leave_calendar_claim_outbox_batch/);
  assert.match(sql, /FOR UPDATE OF o SKIP LOCKED/);
  assert.match(sql, /reconcile_team_leave_upsert/);
  assert.match(sql, /reconcile_google_refresh/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.staff_leave_calendar_claim_outbox_batch/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[\s\S]*TO authenticated/);
});

test("claim filter supports stale processing reclaim", () => {
  const cutoff = "2026-01-01T11:55:00.000Z";
  const filter = buildStaffLeaveCalendarOutboxClaimFilter(cutoff);
  assert.match(filter, /status\.eq\.processing/);
  assert.match(filter, /locked_at\.lt\./);
});

test("stale processing locks are reclaimable", () => {
  const now = Date.parse("2026-01-01T12:00:00.000Z");
  assert.equal(isStaleStaffLeaveCalendarOutboxLock("2026-01-01T11:54:00.000Z", now), true);
});

test("162000 claim migration allows only one row per entity per batch", async () => {
  const sql = await readFile(CLAIM_ONE_PER_ENTITY_MIGRATION, "utf8");

  assert.match(sql, /ROW_NUMBER\(\) OVER/);
  assert.match(sql, /PARTITION BY COALESCE\(e\.leave_request_id, e\.sickness_id\)/);
  assert.match(sql, /entity_row = 1/);
  assert.match(sql, /FOR UPDATE OF o SKIP LOCKED/);
});

test("processor orders sibling rows chronologically", () => {
  const rows = sortCalendarSyncOutboxRows([
    {
      id: "2",
      leave_request_id: "req",
      sickness_id: null,
      created_at: "2027-02-02T10:00:00Z",
    },
    {
      id: "1",
      leave_request_id: "req",
      sickness_id: null,
      created_at: "2027-02-02T09:00:00Z",
    },
  ]);

  assert.deepEqual(
    rows.map((row) => row.id),
    ["1", "2"]
  );
});
