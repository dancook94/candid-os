import assert from "node:assert/strict";
import test from "node:test";

import { ENGLAND_WALES_BANK_HOLIDAYS_2027 } from "@/lib/staff-leave/bank-holidays-2027";
import { patternFromFlags } from "@/lib/staff-leave/entitlement-breakdown";
import { segmentedBookableEntitlement } from "@/lib/staff-leave/segmented-entitlement";
import { CHRISTMAS_2027_ALL_CLOSURES } from "@/lib/staff-leave/christmas-2027";
import { DEFAULT_MON_FRI_PATTERN } from "@/lib/staff-leave/working-days";

const MON_FRI = DEFAULT_MON_FRI_PATTERN;
const THREE_DAY = patternFromFlags({
  worksMon: true,
  worksTue: false,
  worksWed: true,
  worksThu: false,
  worksFri: true,
  worksSat: false,
  worksSun: false,
});
/** 3 scheduled days per week ≈ 0.6 FTE vs Mon–Fri (admin should align fte_ratio with pattern). */
const THREE_DAY_FTE = 0.6;

test("future-effective segment is ignored before its effective date (req 1)", () => {
  const baseline = segmentedBookableEntitlement({
    holidayYear: 2027,
    grossPolicyDays: 28,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    asOf: "2027-06-15",
    segments: [{ effectiveFrom: "2027-01-01", pattern: MON_FRI, fteRatio: 1 }],
  });

  const withFutureJuly = segmentedBookableEntitlement({
    holidayYear: 2027,
    grossPolicyDays: 28,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    asOf: "2027-06-15",
    segments: [
      { effectiveFrom: "2027-01-01", pattern: MON_FRI, fteRatio: 1 },
      { effectiveFrom: "2027-07-01", pattern: THREE_DAY, fteRatio: THREE_DAY_FTE },
    ],
  });

  assert.equal(withFutureJuly.bookableEntitlementDays, baseline.bookableEntitlementDays);
  assert.equal(baseline.bookableEntitlementDays, 17);
});

test("after mid-year change, entitlement includes both segments (req 2)", () => {
  const june = segmentedBookableEntitlement({
    holidayYear: 2027,
    grossPolicyDays: 28,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    asOf: "2027-06-15",
    segments: [
      { effectiveFrom: "2027-01-01", pattern: MON_FRI, fteRatio: 1 },
      { effectiveFrom: "2027-07-01", pattern: THREE_DAY, fteRatio: THREE_DAY_FTE },
    ],
  });

  const december = segmentedBookableEntitlement({
    holidayYear: 2027,
    grossPolicyDays: 28,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    asOf: "2027-12-01",
    segments: [
      { effectiveFrom: "2027-01-01", pattern: MON_FRI, fteRatio: 1 },
      { effectiveFrom: "2027-07-01", pattern: THREE_DAY, fteRatio: THREE_DAY_FTE },
    ],
  });

  assert.equal(june.bookableEntitlementDays, 17);
  assert.ok(december.bookableEntitlementDays < june.bookableEntitlementDays);
  assert.equal(december.bookableEntitlementDays, 14.88);
});

test("5 days/week Jan–Jun then 3 days/week Jul–Dec (req 3)", () => {
  const result = segmentedBookableEntitlement({
    holidayYear: 2027,
    grossPolicyDays: 28,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    asOf: "2027-12-31",
    segments: [
      { effectiveFrom: "2027-01-01", pattern: MON_FRI, fteRatio: 1 },
      { effectiveFrom: "2027-07-01", pattern: THREE_DAY, fteRatio: THREE_DAY_FTE },
    ],
  });

  const fullTimeWholeYear = segmentedBookableEntitlement({
    holidayYear: 2027,
    grossPolicyDays: 28,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    asOf: "2027-12-31",
    segments: [{ effectiveFrom: "2027-01-01", pattern: MON_FRI, fteRatio: 1 }],
  });

  assert.ok(result.bookableEntitlementDays < fullTimeWholeYear.bookableEntitlementDays);
  assert.ok(result.bookableEntitlementDays >= 12);
  assert.ok(result.bookableEntitlementDays <= 17);
  assert.equal(result.bookableEntitlementDays, 14.88);
});

test("3 days/week Jan–Jun then 5 days/week Jul–Dec (req 4)", () => {
  const result = segmentedBookableEntitlement({
    holidayYear: 2027,
    grossPolicyDays: 28,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    asOf: "2027-12-31",
    segments: [
      { effectiveFrom: "2027-01-01", pattern: THREE_DAY, fteRatio: THREE_DAY_FTE },
      { effectiveFrom: "2027-07-01", pattern: MON_FRI, fteRatio: 1 },
    ],
  });

  const swapped = segmentedBookableEntitlement({
    holidayYear: 2027,
    grossPolicyDays: 28,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    asOf: "2027-12-31",
    segments: [
      { effectiveFrom: "2027-01-01", pattern: MON_FRI, fteRatio: 1 },
      { effectiveFrom: "2027-07-01", pattern: THREE_DAY, fteRatio: THREE_DAY_FTE },
    ],
  });

  assert.notEqual(
    result.bookableEntitlementDays,
    swapped.bookableEntitlementDays
  );
});

test("snapshot-date FTE alone must not define full-year entitlement (req 6)", () => {
  const withFuturePartTime = segmentedBookableEntitlement({
    holidayYear: 2027,
    grossPolicyDays: 28,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: CHRISTMAS_2027_ALL_CLOSURES,
    asOf: "2027-03-01",
    segments: [
      { effectiveFrom: "2027-01-01", pattern: MON_FRI, fteRatio: 1 },
      { effectiveFrom: "2027-07-01", pattern: MON_FRI, fteRatio: 0.5 },
    ],
  });

  const naiveFullYearHalfFte = 8.5;
  assert.notEqual(withFuturePartTime.bookableEntitlementDays, naiveFullYearHalfFte);
  assert.ok(withFuturePartTime.bookableEntitlementDays > naiveFullYearHalfFte - 1);
});

test("proposed snapshot migration is superseded by segmented migration", async () => {
  const { readFile } = await import("node:fs/promises");
  const segmented = await readFile(
    new URL(
      "../../supabase/migrations/20270110152000_staff_leave_reserved_pool_snapshot.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(segmented, /staff_leave_entitlement_days_segmented|segmented/);
  assert.doesNotMatch(segmented, /staff_leave_is_working_day_snapshot/);
});

test("revision uses per-segment reserved counts, not LEAST snapshot hack (req 9)", async () => {
  const { readFile } = await import("node:fs/promises");
  const segmented = await readFile(
    new URL(
      "../../supabase/migrations/20270110152000_staff_leave_reserved_pool_snapshot.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(segmented, /staff_leave_reserved_pool_in_range/);
  assert.doesNotMatch(segmented, /LEAST\(on_date, snapshot_as_of\)/);
});
