import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  annualApprovalHeadroom,
  calculateLeaveBalance,
  canApproveAnnualRequest,
  proRataEntitlementDays,
} from "@/lib/staff-leave/balance";
import { ENGLAND_WALES_BANK_HOLIDAYS_2027 } from "@/lib/staff-leave/bank-holidays-2027";
import { CHRISTMAS_2027_ALL_CLOSURES } from "@/lib/staff-leave/christmas-2027";
import { leaveRangesOverlap } from "@/lib/staff-leave/leave-absence-overlap";

const PATTERNS = new URL(
  "../../supabase/migrations/20270110150000_staff_leave_patterns_additional_paid.sql",
  import.meta.url
);

const FULL_TIME_ENTITLEMENT = 17;

test("patterns migration enforces approval headroom, profile locks, and GiST exclusion", async () => {
  const sql = await readFile(PATTERNS, "utf8");

  assert.match(sql, /staff_leave_annual_approval_headroom/);
  assert.match(sql, /staff_leave_lock_profile/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.staff_leave_lock_profile/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.staff_leave_annual_approval_headroom/);
  assert.match(
    sql,
    /decide_staff_leave_request[\s\S]*staff_leave_annual_approval_headroom/
  );
  assert.match(sql, /Insufficient remaining leave balance to approve this request/);
  assert.match(sql, /staff_leave_requests_active_dates_no_overlap/);
  assert.match(sql, /btree_gist/);
  assert.match(sql, /WHEN exclusion_violation THEN/);
  assert.match(sql, /cancel_staff_leave_request[\s\S]*staff_leave_lock_profile/);
});

test("two pending requests exceeding allowance: neither approves while both remain pending", () => {
  const requests = [
    {
      id: "a",
      startDate: "2027-08-02",
      endDate: "2027-08-06",
      daysRequested: 5,
      status: "pending" as const,
    },
    {
      id: "b",
      startDate: "2027-09-01",
      endDate: "2027-09-05",
      daysRequested: 5,
      status: "pending" as const,
    },
  ];

  const first = canApproveAnnualRequest({
    holidayYear: 2027,
    entitlementDays: 8,
    requests,
    requestId: "a",
    requestDays: 5,
  });
  assert.equal(first.canApprove, false);
  assert.equal(first.headroom, 3);

  const second = canApproveAnnualRequest({
    holidayYear: 2027,
    entitlementDays: 8,
    requests,
    requestId: "b",
    requestDays: 5,
  });
  assert.equal(second.canApprove, false);
});

test("after one pending request is declined, the other can be approved within allowance", () => {
  const requests = [
    {
      id: "a",
      startDate: "2027-08-02",
      endDate: "2027-08-06",
      daysRequested: 5,
      status: "rejected" as const,
    },
    {
      id: "b",
      startDate: "2027-09-01",
      endDate: "2027-09-05",
      daysRequested: 5,
      status: "pending" as const,
    },
  ];

  const approval = canApproveAnnualRequest({
    holidayYear: 2027,
    entitlementDays: 8,
    requests,
    requestId: "b",
    requestDays: 5,
  });
  assert.equal(approval.canApprove, true);
});

test("entitlement reduction after submit blocks later approval", () => {
  const requests = [
    {
      id: "solo",
      startDate: "2027-07-12",
      endDate: "2027-07-16",
      daysRequested: 5,
      status: "pending" as const,
    },
  ];

  const before = canApproveAnnualRequest({
    holidayYear: 2027,
    entitlementDays: 17,
    requests,
    requestId: "solo",
    requestDays: 5,
  });
  assert.equal(before.canApprove, true);

  const afterReduction = canApproveAnnualRequest({
    holidayYear: 2027,
    entitlementDays: 4,
    requests,
    requestId: "solo",
    requestDays: 5,
  });
  assert.equal(afterReduction.canApprove, false);
});

test("approval headroom excludes the request being approved from pending", () => {
  const headroom = annualApprovalHeadroom({
    holidayYear: 2027,
    entitlementDays: 10,
    excludeRequestId: "target",
    requests: [
      {
        id: "other",
        startDate: "2027-06-01",
        endDate: "2027-06-01",
        daysRequested: 3,
        status: "pending",
      },
      {
        id: "target",
        startDate: "2027-07-01",
        endDate: "2027-07-01",
        daysRequested: 4,
        status: "pending",
      },
    ],
  });

  assert.equal(headroom, 7);
  assert.equal(canApproveAnnualRequest({
    holidayYear: 2027,
    entitlementDays: 10,
    requests: [
      {
        id: "other",
        startDate: "2027-06-01",
        endDate: "2027-06-01",
        daysRequested: 3,
        status: "pending",
      },
      {
        id: "target",
        startDate: "2027-07-01",
        endDate: "2027-07-01",
        daysRequested: 4,
        status: "pending",
      },
    ],
    requestId: "target",
    requestDays: 4,
  }).canApprove, true);
});

test("concurrent overlapping additional paid grants are blocked by date overlap", () => {
  const existing = { start: "2027-06-10", end: "2027-06-12" };
  const concurrent = { start: "2027-06-11", end: "2027-06-13" };

  assert.equal(
    leaveRangesOverlap(existing.start, existing.end, concurrent.start, concurrent.end),
    true
  );
});

test("concurrent annual approvals on overlapping dates cannot both be active", () => {
  assert.equal(leaveRangesOverlap("2027-05-10", "2027-05-12", "2027-05-12", "2027-05-14"), true);
});

test("cancellation frees allowance for rebooking non-overlapping dates", () => {
  const before = calculateLeaveBalance({
    holidayYear: 2027,
    grossPolicyDays: 28,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    fteRatio: 1,
    adjustmentDays: 0,
    requests: [
      {
        startDate: "2027-06-07",
        endDate: "2027-06-07",
        daysRequested: 5,
        status: "approved",
      },
    ],
  });

  const afterCancel = calculateLeaveBalance({
    holidayYear: 2027,
    grossPolicyDays: 28,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    fteRatio: 1,
    adjustmentDays: 0,
    requests: [
      {
        startDate: "2027-06-07",
        endDate: "2027-06-07",
        daysRequested: 5,
        status: "cancelled",
      },
      {
        startDate: "2027-08-01",
        endDate: "2027-08-01",
        daysRequested: 1,
        status: "pending",
      },
    ],
  });

  assert.equal(before.remainingDays, 12);
  assert.equal(afterCancel.remainingDays, 16);
  assert.equal(
    leaveRangesOverlap("2027-06-07", "2027-06-07", "2027-08-01", "2027-08-01"),
    false
  );
});

test("part-time allowance governs concurrent approval headroom", () => {
  const partTimeEntitlement = proRataEntitlementDays({
    grossPolicyDays: 28,
    reservedPoolDays: 11,
    fteRatio: 0.5,
    adjustmentDays: 0,
    holidayYear: 2027,
  });
  assert.equal(partTimeEntitlement, 8.5);

  const approval = canApproveAnnualRequest({
    holidayYear: 2027,
    entitlementDays: partTimeEntitlement,
    requests: [
      {
        id: "p1",
        startDate: "2027-04-01",
        endDate: "2027-04-03",
        daysRequested: 3,
        status: "approved",
      },
      {
        id: "p2",
        startDate: "2027-05-01",
        endDate: "2027-05-04",
        daysRequested: 4,
        status: "pending",
      },
    ],
    requestId: "p2",
    requestDays: 4,
  });

  assert.equal(approval.headroom, 5.5);
  assert.equal(approval.canApprove, true);
});

test("full-time 17-day allowance matches standard approval scenario", () => {
  assert.equal(FULL_TIME_ENTITLEMENT, 17);
  const approval = canApproveAnnualRequest({
    holidayYear: 2027,
    entitlementDays: FULL_TIME_ENTITLEMENT,
    requests: [],
    requestId: "new",
    requestDays: 17,
  });
  assert.equal(approval.canApprove, true);
});
