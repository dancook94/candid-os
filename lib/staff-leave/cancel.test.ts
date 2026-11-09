import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { calculateLeaveBalance } from "@/lib/staff-leave/balance";
import { ENGLAND_WALES_BANK_HOLIDAYS_2027 } from "@/lib/staff-leave/bank-holidays-2027";
import {
  evaluateLeaveCancellationEligibility,
  leaveHasStartedInLondon,
} from "@/lib/staff-leave/cancel-policy";
import { CHRISTMAS_2027_ALL_CLOSURES } from "@/lib/staff-leave/christmas-2027";

const CANCEL_MIGRATION = new URL(
  "../../supabase/migrations/20270110140000_staff_leave_cancellation.sql",
  import.meta.url
);
const PHASE1_MIGRATION = new URL(
  "../../supabase/migrations/20270110120000_staff_leave_phase1.sql",
  import.meta.url
);

const LONDON_TODAY = "2027-06-15";

test("cancellation migration enforces London start rules in RPC without renaming parameters", async () => {
  const sql = await readFile(CANCEL_MIGRATION, "utf8");
  const phase1 = await readFile(PHASE1_MIGRATION, "utf8");

  assert.match(sql, /cancel_staff_leave_request\(\s*\n\s*p_request_id uuid,\s*\n\s*p_cancellation_note text/);
  assert.match(sql, /AT TIME ZONE 'Europe\/London'\)::date/);
  assert.match(sql, /request_start <= london_today/);
  assert.match(sql, /already started can only be cancelled by management/);
  assert.match(sql, /cancellation reason is required when cancelling leave that has already started/);
  assert.match(sql, /cancellation_reason text/);
  assert.match(sql, /'start_date', request_start/);
  assert.match(sql, /'end_date', request_end/);
  assert.match(sql, /'cancelled_by', actor/);
  assert.match(sql, /'cancellation_reason', reason/);
  assert.doesNotMatch(sql, /gmail_/i);

  assert.match(phase1, /decide_staff_leave_request\(\s*\n\s*p_request_id uuid/);
  assert.match(phase1, /submit_staff_leave_request\(\s*\n\s*p_start_date date/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.decide_staff_leave_request/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.submit_staff_leave_request/);
});

test("staff cancel route calls cancel_staff_leave_request and maps duplicates to 409", async () => {
  const source = await readFile(
    new URL("../../app/api/staff/leave/requests/[id]/cancel/route.ts", import.meta.url),
    "utf8"
  );

  assert.match(source, /cancel_staff_leave_request/);
  assert.match(source, /p_request_id: id/);
  assert.match(source, /p_cancellation_note/);
  assert.match(source, /already cancelled/);
  assert.match(source, /\? 409/);
});

test("staff may cancel own pending leave immediately", () => {
  const result = evaluateLeaveCancellationEligibility({
    status: "pending",
    startDate: "2027-12-01",
    actorProfileId: "staff-1",
    ownerProfileId: "staff-1",
    isApprovedAdmin: false,
    londonToday: LONDON_TODAY,
  });

  assert.deepEqual(result, { canCancel: true, requiresReason: false });
});

test("staff may cancel own future approved leave", () => {
  const result = evaluateLeaveCancellationEligibility({
    status: "approved",
    startDate: "2027-08-01",
    actorProfileId: "staff-1",
    ownerProfileId: "staff-1",
    isApprovedAdmin: false,
    londonToday: LONDON_TODAY,
  });

  assert.deepEqual(result, { canCancel: true, requiresReason: false });
});

test("staff cannot cancel own approved leave once it has started", () => {
  const ongoing = evaluateLeaveCancellationEligibility({
    status: "approved",
    startDate: LONDON_TODAY,
    actorProfileId: "staff-1",
    ownerProfileId: "staff-1",
    isApprovedAdmin: false,
    londonToday: LONDON_TODAY,
  });
  const historical = evaluateLeaveCancellationEligibility({
    status: "approved",
    startDate: "2027-03-01",
    actorProfileId: "staff-1",
    ownerProfileId: "staff-1",
    isApprovedAdmin: false,
    londonToday: LONDON_TODAY,
  });

  assert.deepEqual(ongoing, { canCancel: false, reason: "started_requires_management" });
  assert.deepEqual(historical, { canCancel: false, reason: "started_requires_management" });
});

test("management may cancel started or historical approved leave with a reason", () => {
  const ongoing = evaluateLeaveCancellationEligibility({
    status: "approved",
    startDate: LONDON_TODAY,
    actorProfileId: "admin-1",
    ownerProfileId: "staff-2",
    isApprovedAdmin: true,
    londonToday: LONDON_TODAY,
  });
  const historical = evaluateLeaveCancellationEligibility({
    status: "approved",
    startDate: "2027-02-01",
    actorProfileId: "admin-1",
    ownerProfileId: "staff-2",
    isApprovedAdmin: true,
    londonToday: LONDON_TODAY,
  });

  assert.deepEqual(ongoing, { canCancel: true, requiresReason: true });
  assert.deepEqual(historical, { canCancel: true, requiresReason: true });
});

test("management may cancel future approved leave on behalf without a required reason in UI", () => {
  const result = evaluateLeaveCancellationEligibility({
    status: "approved",
    startDate: "2027-12-10",
    actorProfileId: "admin-1",
    ownerProfileId: "staff-2",
    isApprovedAdmin: true,
    londonToday: LONDON_TODAY,
  });

  assert.deepEqual(result, { canCancel: true, requiresReason: false });
});

test("staff cannot cancel another employee's request", () => {
  const result = evaluateLeaveCancellationEligibility({
    status: "pending",
    startDate: "2027-12-01",
    actorProfileId: "staff-1",
    ownerProfileId: "staff-2",
    isApprovedAdmin: false,
    londonToday: LONDON_TODAY,
  });

  assert.deepEqual(result, { canCancel: false, reason: "forbidden" });
});

test("leaveHasStartedInLondon compares ISO dates against London today", () => {
  assert.equal(leaveHasStartedInLondon("2027-06-14", "2027-06-15"), true);
  assert.equal(leaveHasStartedInLondon("2027-06-16", "2027-06-15"), false);
});

function balanceFixture(requests: Parameters<typeof calculateLeaveBalance>[0]["requests"]) {
  return calculateLeaveBalance({
    holidayYear: 2027,
    grossPolicyDays: 28,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    fteRatio: 1,
    adjustmentDays: 0,
    requests,
  });
}

test("cancelling pending leave restores remaining allowance", () => {
  const before = balanceFixture([
    {
      startDate: "2027-08-02",
      endDate: "2027-08-02",
      daysRequested: 2,
      status: "pending",
    },
    {
      startDate: "2027-09-01",
      endDate: "2027-09-01",
      daysRequested: 1,
      status: "approved",
    },
  ]);

  assert.equal(before.remainingDays, 14);

  const after = balanceFixture([
    {
      startDate: "2027-08-02",
      endDate: "2027-08-02",
      daysRequested: 2,
      status: "cancelled",
    },
    {
      startDate: "2027-09-01",
      endDate: "2027-09-01",
      daysRequested: 1,
      status: "approved",
    },
  ]);

  assert.equal(after.pendingDays, 0);
  assert.equal(after.remainingDays, 16);
});

test("cancelling approved leave restores used days", () => {
  const before = balanceFixture([
    {
      startDate: "2027-06-14",
      endDate: "2027-06-16",
      daysRequested: 3,
      status: "approved",
    },
  ]);

  assert.equal(before.usedApprovedDays, 3);
  assert.equal(before.remainingDays, 14);

  const after = balanceFixture([
    {
      startDate: "2027-06-14",
      endDate: "2027-06-16",
      daysRequested: 3,
      status: "cancelled",
    },
  ]);

  assert.equal(after.usedApprovedDays, 0);
  assert.equal(after.remainingDays, 17);
});

test("history UI mirrors eligibility and requires reason in dialog when needed", async () => {
  const history = await readFile(
    new URL("../../components/staff-leave/leave-requests-history.tsx", import.meta.url),
    "utf8"
  );
  const dialog = await readFile(
    new URL("../../components/staff-leave/leave-cancel-dialog.tsx", import.meta.url),
    "utf8"
  );

  assert.match(history, /evaluateLeaveCancellationEligibility/);
  assert.match(history, /eligibility\.canCancel/);
  assert.doesNotMatch(history, /isLeaveRequestCancellable\(request\.status\)/);
  assert.match(dialog, /requiresReason/);
  assert.match(dialog, /Cancellation reason/);
});
