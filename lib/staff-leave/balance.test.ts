import assert from "node:assert/strict";
import test from "node:test";

import { ENGLAND_WALES_BANK_HOLIDAYS_2027 } from "@/lib/staff-leave/bank-holidays-2027";
import { calculateLeaveBalance, calculateReservedPoolDays, proRataEntitlementDays } from "@/lib/staff-leave/balance";
import { CHRISTMAS_2027_ALL_CLOSURES } from "@/lib/staff-leave/christmas-2027";
import { countNonBookableClosureDays, DEFAULT_MON_FRI_PATTERN } from "@/lib/staff-leave/working-days";

test("2027 full-time Mon–Fri reserved pool is 8 bank holidays plus 3 company closures", () => {
  const reserved = calculateReservedPoolDays({
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    pattern: DEFAULT_MON_FRI_PATTERN,
  });

  assert.equal(reserved, 11);
});

test("standard 2027 bookable allowance is 17 days for full-time staff", () => {
  const reserved = 11;
  const entitlement = proRataEntitlementDays({
    grossPolicyDays: 28,
    reservedPoolDays: reserved,
    fteRatio: 1,
    adjustmentDays: 0,
    holidayYear: 2027,
  });

  assert.equal(entitlement, 17);
});

test("gifted paid closure does not reduce bookable allowance", () => {
  const reserved = calculateReservedPoolDays({
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    pattern: DEFAULT_MON_FRI_PATTERN,
  });

  assert.equal(reserved, 11);

  const nonBookableClosures = countNonBookableClosureDays({
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    pattern: DEFAULT_MON_FRI_PATTERN,
  });

  assert.equal(nonBookableClosures, 4);
});

test("compulsory Christmas 2027 days match policy (24, 29, 30 Dec)", () => {
  const compulsory = CHRISTMAS_2027_ALL_CLOSURES.filter((c) => c.closureKind === "compulsory_leave");
  assert.deepEqual(
    compulsory.map((c) => c.date).sort(),
    ["2027-12-24", "2027-12-29", "2027-12-30"]
  );
});

test("pending requests reserve balance; approved requests consume it", () => {
  const balance = calculateLeaveBalance({
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
        daysRequested: 1,
        status: "approved",
      },
      {
        startDate: "2027-07-05",
        endDate: "2027-07-05",
        daysRequested: 0.5,
        status: "pending",
      },
    ],
  });

  assert.equal(balance.entitlementDays, 17);
  assert.equal(balance.usedApprovedDays, 1);
  assert.equal(balance.pendingDays, 0.5);
  assert.equal(balance.remainingDays, 15.5);
});

test("part-time 0.5 FTE receives half the bookable allowance", () => {
  const entitlement = proRataEntitlementDays({
    grossPolicyDays: 28,
    reservedPoolDays: 11,
    fteRatio: 0.5,
    adjustmentDays: 0,
    holidayYear: 2027,
  });

  assert.equal(entitlement, 8.5);
});

test("authorised management adjustment changes entitlement without carryover", () => {
  const entitlement = proRataEntitlementDays({
    grossPolicyDays: 28,
    reservedPoolDays: 11,
    fteRatio: 1,
    adjustmentDays: 2.5,
    holidayYear: 2027,
  });

  assert.equal(entitlement, 19.5);
});
