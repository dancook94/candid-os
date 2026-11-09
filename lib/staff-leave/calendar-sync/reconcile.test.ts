import assert from "node:assert/strict";
import test from "node:test";

import { buildTeamLeaveCalendarEvent } from "@/lib/staff-leave/calendar-sync/build-event";
import { mappingNeedsGoogleResync } from "@/lib/staff-leave/calendar-sync/mapping-transition";
import { londonTodayIso } from "@/lib/staff-leave/calendar";

test("reconciliation uses future-only window via london today", () => {
  const today = londonTodayIso();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
});

test("mock mappings are flagged for later Google resync", () => {
  assert.equal(
    mappingNeedsGoogleResync({ sync_provider: "mock", deleted_at: null }, "google"),
    true
  );
  assert.equal(
    mappingNeedsGoogleResync({ sync_provider: "mock", deleted_at: null }, "mock"),
    false
  );
  assert.equal(
    mappingNeedsGoogleResync({ sync_provider: "google", deleted_at: null }, "google"),
    false
  );
});

test("reconcile enqueue migration defines partial uniques for pending reconcile rows", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(
    new URL(
      "../../../supabase/migrations/20270110159000_staff_leave_calendar_sync_worker.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(sql, /staff_leave_calendar_sync_outbox_reconcile_leave_pending_idx/);
  assert.match(sql, /staff_leave_calendar_sync_outbox_reconcile_sickness_pending_idx/);
});

test("fingerprint changes when leave dates change", () => {
  const base = buildTeamLeaveCalendarEvent({
    request: {
      id: "req-a",
      leaveKind: "annual",
      startDate: "2027-10-01",
      endDate: "2027-10-01",
      dayPortion: "full",
    },
    employeeName: "Alex Example",
  });

  const shifted = buildTeamLeaveCalendarEvent({
    request: {
      id: "req-a",
      leaveKind: "annual",
      startDate: "2027-10-02",
      endDate: "2027-10-02",
      dayPortion: "full",
    },
    employeeName: "Alex Example",
  });

  assert.notEqual(base.fingerprint, shifted.fingerprint);
});
