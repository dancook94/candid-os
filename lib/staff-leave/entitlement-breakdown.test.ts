import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildEntitlementBreakdown, patternFromFlags } from "@/lib/staff-leave/entitlement-breakdown";
import { ENGLAND_WALES_BANK_HOLIDAYS_2027 } from "@/lib/staff-leave/bank-holidays-2027";
import { CHRISTMAS_2027_ALL_CLOSURES } from "@/lib/staff-leave/christmas-2027";
import { DEFAULT_MON_FRI_PATTERN } from "@/lib/staff-leave/working-days";

const MIGRATION = new URL(
  "../../supabase/migrations/20270110150000_staff_leave_patterns_additional_paid.sql",
  import.meta.url
);

test("migration defines pattern RPCs, audit, and additional paid without touching Gmail", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  assert.match(sql, /staff_leave_pattern_for_profile_on_date/);
  assert.match(sql, /set_staff_working_pattern/);
  assert.match(sql, /set_staff_leave_entitlement/);
  assert.match(sql, /leave_kind/);
  assert.match(sql, /additional_paid/);
  assert.match(sql, /staff_leave_used_days[\s\S]*leave_kind = 'annual'/);
  assert.match(sql, /staff_working_patterns_reject_direct_write/);
  assert.doesNotMatch(sql, /gmail_/i);
});

test("gifted Christmas closure is counted separately and does not inflate reserved pool", () => {
  const breakdown = buildEntitlementBreakdown({
    grossPolicyDays: 28,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    pattern: DEFAULT_MON_FRI_PATTERN,
    fteRatio: 1,
    adjustmentDays: 0,
    holidayYear: 2027,
  });

  assert.equal(breakdown.paidGiftClosuresOnWorkingDays, 1);
  assert.equal(breakdown.reservedPoolDays, 11);
  assert.equal(breakdown.bookableEntitlementDays, 17);
});

test("bank holidays on non-working weekdays do not deduct from part-time patterns", () => {
  const weekendsOnly = patternFromFlags({
    worksMon: false,
    worksTue: false,
    worksWed: false,
    worksThu: false,
    worksFri: false,
    worksSat: true,
    worksSun: true,
  });

  const breakdown = buildEntitlementBreakdown({
    grossPolicyDays: 28,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    pattern: weekendsOnly,
    fteRatio: 1,
    adjustmentDays: 0,
    holidayYear: 2027,
  });

  assert.equal(breakdown.bankHolidaysOnWorkingDays, 0);
  assert.equal(breakdown.compulsoryClosuresOnWorkingDays, 0);
  assert.equal(breakdown.reservedPoolDays, 0);
  assert.equal(breakdown.bookableEntitlementDays, 28);
});

test("full-time Mon–Fri retains 17 bookable days after compulsory deductions", () => {
  const breakdown = buildEntitlementBreakdown({
    grossPolicyDays: 28,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    pattern: DEFAULT_MON_FRI_PATTERN,
    fteRatio: 1,
    adjustmentDays: 0,
    holidayYear: 2027,
  });

  assert.equal(breakdown.grossAllowanceDays, 28);
  assert.equal(breakdown.reservedPoolDays, 11);
  assert.equal(breakdown.bookableEntitlementDays, 17);
  assert.equal(breakdown.compulsoryClosuresOnWorkingDays, 3);
  assert.equal(breakdown.paidGiftClosuresOnWorkingDays, 1);
});

test("part-time 0.5 FTE on three-day week reduces reserved pool and bookable allowance", () => {
  const threeDay = patternFromFlags({
    worksMon: true,
    worksTue: false,
    worksWed: true,
    worksThu: false,
    worksFri: true,
    worksSat: false,
    worksSun: false,
  });

  const breakdown = buildEntitlementBreakdown({
    grossPolicyDays: 28,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    pattern: threeDay,
    fteRatio: 0.5,
    adjustmentDays: 0,
    holidayYear: 2027,
  });

  assert.ok(breakdown.reservedPoolDays < 11);
  assert.ok(breakdown.bookableEntitlementDays < 17);
  assert.equal(breakdown.bookableEntitlementDays, 9.5);
  assert.equal(breakdown.fteRatio, 0.5);
});

test("mid-year starter pro-rata reduces bookable entitlement", () => {
  const breakdown = buildEntitlementBreakdown({
    grossPolicyDays: 28,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    pattern: DEFAULT_MON_FRI_PATTERN,
    fteRatio: 1,
    adjustmentDays: 0,
    prorataStartDate: "2027-07-01",
    holidayYear: 2027,
  });

  assert.ok(breakdown.bookableEntitlementDays < 17);
  assert.ok(breakdown.bookableEntitlementDays > 7);
});

test("documented management adjustment changes entitlement", () => {
  const breakdown = buildEntitlementBreakdown({
    grossPolicyDays: 28,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    pattern: DEFAULT_MON_FRI_PATTERN,
    fteRatio: 1,
    adjustmentDays: 2,
    holidayYear: 2027,
  });

  assert.equal(breakdown.bookableEntitlementDays, 19);
});
