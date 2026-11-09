import assert from "node:assert/strict";
import test from "node:test";

import { ENGLAND_WALES_BANK_HOLIDAYS_2027 } from "@/lib/staff-leave/bank-holidays-2027";
import { validateLeaveRequestSubmission } from "@/lib/staff-leave/validate-request";
import { DEFAULT_MON_FRI_PATTERN } from "@/lib/staff-leave/working-days";

import { CHRISTMAS_2027_ALL_CLOSURES } from "@/lib/staff-leave/christmas-2027";

const CLOSURES = CHRISTMAS_2027_ALL_CLOSURES;

test("rejects overlapping pending or approved requests", () => {
  const result = validateLeaveRequestSubmission({
    startDate: "2027-09-06",
    endDate: "2027-09-08",
    dayPortion: "full",
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CLOSURES,
    pattern: DEFAULT_MON_FRI_PATTERN,
    grossPolicyDays: 28,
    fteRatio: 1,
    adjustmentDays: 0,
    existingRequests: [
      {
        id: "existing-1",
        startDate: "2027-09-07",
        endDate: "2027-09-07",
        daysRequested: 1,
        status: "pending",
      },
    ],
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "overlapping_request");
  }
});

test("rejects requests before 2027", () => {
  const result = validateLeaveRequestSubmission({
    startDate: "2026-12-20",
    endDate: "2026-12-20",
    dayPortion: "full",
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CLOSURES,
    pattern: DEFAULT_MON_FRI_PATTERN,
    grossPolicyDays: 28,
    fteRatio: 1,
    adjustmentDays: 0,
    existingRequests: [],
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "before_policy_year");
  }
});

test("rejects requests that exceed remaining balance", () => {
  const result = validateLeaveRequestSubmission({
    startDate: "2027-06-07",
    endDate: "2027-07-02",
    dayPortion: "full",
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CLOSURES,
    pattern: DEFAULT_MON_FRI_PATTERN,
    grossPolicyDays: 28,
    fteRatio: 1,
    adjustmentDays: 0,
    existingRequests: [],
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "insufficient_balance");
  }
});
