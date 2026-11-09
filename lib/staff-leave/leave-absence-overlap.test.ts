import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { hasBlockingLeaveOverlap } from "@/lib/staff-leave/leave-absence-overlap";

const MIGRATION = new URL(
  "../../supabase/migrations/20270110150000_staff_leave_patterns_additional_paid.sql",
  import.meta.url
);

test("migration enforces cross-kind overlap in submit, grant and decide paths", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  assert.match(sql, /staff_leave_has_blocking_overlap/);
  assert.match(sql, /overlap existing annual or additional paid leave/);
  assert.match(sql, /submit_staff_additional_paid_leave_request[\s\S]*staff_leave_has_blocking_overlap/);
  assert.match(sql, /grant_staff_additional_paid_leave[\s\S]*staff_leave_has_blocking_overlap/);
  assert.match(sql, /decide_staff_leave_request[\s\S]*staff_leave_has_blocking_overlap/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.staff_leave_has_blocking_overlap/);
});

test("pending annual blocks additional paid on overlapping dates", () => {
  const blocked = hasBlockingLeaveOverlap(
    [
      {
        id: "annual-1",
        startDate: "2027-07-12",
        endDate: "2027-07-14",
        status: "pending",
        leaveKind: "annual",
      },
    ],
    "2027-07-13",
    "2027-07-13"
  );
  assert.equal(blocked, true);
});

test("approved additional paid blocks duplicate grant window", () => {
  const blocked = hasBlockingLeaveOverlap(
    [
      {
        id: "apl-1",
        startDate: "2027-08-02",
        endDate: "2027-08-02",
        status: "approved",
        leaveKind: "additional_paid",
      },
    ],
    "2027-08-02",
    "2027-08-02"
  );
  assert.equal(blocked, true);
});

test("decision can exclude the request being approved", () => {
  const blocked = hasBlockingLeaveOverlap(
    [
      {
        id: "req-1",
        startDate: "2027-09-01",
        endDate: "2027-09-01",
        status: "pending",
        leaveKind: "additional_paid",
      },
    ],
    "2027-09-01",
    "2027-09-01",
    "req-1"
  );
  assert.equal(blocked, false);
});
