import assert from "node:assert/strict";
import test from "node:test";

import {
  validateLeaveCalendarOperation,
  validateSicknessCalendarOperation,
} from "@/lib/staff-leave/calendar-sync/source-state";

test("upsert requires approved leave", () => {
  assert.deepEqual(validateLeaveCalendarOperation("upsert", { status: "approved", leave_kind: "annual" }), {
    ok: true,
  });

  const cancelled = validateLeaveCalendarOperation("upsert", { status: "cancelled", leave_kind: "annual" });
  assert.equal(cancelled.ok, false);
  if (!cancelled.ok) {
    assert.equal(cancelled.reason, "upsert_requires_approved_leave");
  }
});

test("delete requires cancelled leave", () => {
  assert.deepEqual(validateLeaveCalendarOperation("delete", { status: "cancelled", leave_kind: "annual" }), {
    ok: true,
  });

  const pending = validateLeaveCalendarOperation("delete", { status: "pending", leave_kind: "annual" });
  assert.equal(pending.ok, false);
  if (!pending.ok) {
    assert.equal(pending.reason, "delete_requires_cancelled_leave");
  }
});

test("sickness queue only supports upsert", () => {
  assert.deepEqual(validateSicknessCalendarOperation("upsert"), { ok: true });

  const del = validateSicknessCalendarOperation("delete");
  assert.equal(del.ok, false);
  if (!del.ok) {
    assert.equal(del.reason, "delete_not_supported_for_sickness");
  }
});
