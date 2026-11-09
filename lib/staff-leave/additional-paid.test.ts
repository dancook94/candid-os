import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { calculateLeaveBalance } from "@/lib/staff-leave/balance";
import { ENGLAND_WALES_BANK_HOLIDAYS_2027 } from "@/lib/staff-leave/bank-holidays-2027";
import { CHRISTMAS_2027_ALL_CLOSURES } from "@/lib/staff-leave/christmas-2027";

test("additional paid leave does not reduce annual balance in client model", () => {
  const withAdditional = calculateLeaveBalance({
    holidayYear: 2027,
    grossPolicyDays: 28,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    fteRatio: 1,
    adjustmentDays: 0,
    requests: [
      { startDate: "2027-08-01", endDate: "2027-08-01", daysRequested: 2, status: "approved" },
    ],
  });

  const mixed = calculateLeaveBalance({
    holidayYear: 2027,
    grossPolicyDays: 28,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    fteRatio: 1,
    adjustmentDays: 0,
    requests: [
      { startDate: "2027-08-01", endDate: "2027-08-01", daysRequested: 2, status: "approved" },
      {
        startDate: "2027-09-01",
        endDate: "2027-09-01",
        daysRequested: 1,
        status: "approved",
        leaveKind: "additional_paid",
      },
    ],
  });

  assert.equal(withAdditional.remainingDays, 15);
  assert.equal(mixed.remainingDays, 15);
});

test("API routes for additional paid call dedicated RPCs", async () => {
  const staffRoute = await readFile(
    new URL("../../app/api/staff/leave/additional-paid/route.ts", import.meta.url),
    "utf8"
  );
  const adminGrant = await readFile(
    new URL("../../app/api/admin/leave/additional-paid/route.ts", import.meta.url),
    "utf8"
  );

  assert.match(staffRoute, /submit_staff_additional_paid_leave_request/);
  assert.match(adminGrant, /grant_staff_additional_paid_leave/);
  assert.match(adminGrant, /canDecideLeaveRequests/);
});
