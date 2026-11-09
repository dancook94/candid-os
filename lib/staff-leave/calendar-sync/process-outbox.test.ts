import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  STAFF_LEAVE_CALENDAR_OUTBOX_MAX_ATTEMPTS,
  STAFF_LEAVE_CALENDAR_OUTBOX_STALE_LOCK_MS,
} from "@/lib/staff-leave/calendar-sync/outbox-constants";
import {
  buildStaffLeaveCalendarOutboxClaimFilter,
  isStaleStaffLeaveCalendarOutboxLock,
  staleStaffLeaveCalendarOutboxLockCutoff,
} from "@/lib/staff-leave/calendar-sync/process-outbox";
import { sortCalendarSyncOutboxRows } from "@/lib/staff-leave/calendar-sync/outbox-order";

test("stale lock detection matches notification processor pattern", () => {
  const now = Date.parse("2026-01-01T12:00:00.000Z");
  const fresh = "2026-01-01T11:56:00.000Z";
  const stale = "2026-01-01T11:54:59.000Z";

  assert.equal(isStaleStaffLeaveCalendarOutboxLock(null, now), true);
  assert.equal(isStaleStaffLeaveCalendarOutboxLock(fresh, now), false);
  assert.equal(isStaleStaffLeaveCalendarOutboxLock(stale, now), true);
});

test("claim filter includes pending, failed, and stale processing", () => {
  const cutoff = staleStaffLeaveCalendarOutboxLockCutoff(Date.parse("2026-01-01T12:00:00.000Z"));
  const filter = buildStaffLeaveCalendarOutboxClaimFilter(cutoff);

  assert.match(filter, /status\.in\.\(pending,failed\)/);
  assert.match(filter, /status\.eq\.processing/);
});

test("outbox rows for one leave request are processed in created_at order", () => {
  const ordered = sortCalendarSyncOutboxRows([
    {
      id: "b",
      leave_request_id: "req-1",
      sickness_id: null,
      created_at: "2027-01-02T10:00:00.000Z",
    },
    {
      id: "a",
      leave_request_id: "req-1",
      sickness_id: null,
      created_at: "2027-01-02T09:00:00.000Z",
    },
  ]);

  assert.deepEqual(
    ordered.map((row) => row.id),
    ["a", "b"]
  );
});

test("processor validates source state, marks sync_provider, and tracks mock delivery", async () => {
  const source = await readFile(new URL("./process-outbox.ts", import.meta.url), "utf8");

  assert.match(source, /validateLeaveCalendarOperation/);
  assert.match(source, /markCalendarOutboxDiscarded/);
  assert.match(source, /sync_provider/);
  assert.match(source, /mockDelivered/);
  assert.match(source, /sortCalendarSyncOutboxRows/);
  assert.match(source, /claimCalendarOutboxBatch/);
  assert.match(source, /hasFreshCalendarOutboxSiblingProcessing/);
  assert.match(source, /staff_leave_requests_select_denied/);
  assert.match(source, /STAFF_LEAVE_CALENDAR_OUTBOX_MAX_ATTEMPTS/);
});

test("retry limit constant remains five attempts", () => {
  assert.equal(STAFF_LEAVE_CALENDAR_OUTBOX_MAX_ATTEMPTS, 5);
  assert.equal(STAFF_LEAVE_CALENDAR_OUTBOX_STALE_LOCK_MS, 5 * 60 * 1000);
});
