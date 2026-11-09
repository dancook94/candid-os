import assert from "node:assert/strict";
import test from "node:test";

import { ENGLAND_WALES_BANK_HOLIDAYS_2027 } from "@/lib/staff-leave/bank-holidays-2027";
import {
  countLeaveDaysInRange,
  DEFAULT_MON_FRI_PATTERN,
  holidayYearForStartDate,
} from "@/lib/staff-leave/working-days";

test("half-day leave counts as 0.5 on a working day", () => {
  const days = countLeaveDaysInRange({
    startDate: "2027-06-08",
    endDate: "2027-06-08",
    dayPortion: "am",
    pattern: DEFAULT_MON_FRI_PATTERN,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: [],
  });

  assert.equal(days, 0.5);
});

test("multi-day span skips weekends and bank holidays", () => {
  const days = countLeaveDaysInRange({
    startDate: "2027-05-28",
    endDate: "2027-06-04",
    dayPortion: "full",
    pattern: DEFAULT_MON_FRI_PATTERN,
    bankHolidays: ENGLAND_WALES_BANK_HOLIDAYS_2027,
    companyClosures: [],
  });

  // Fri 28, skip weekend, Mon 31 is spring bank holiday, Tue 1, Wed 2, Thu 3, Fri 4
  assert.equal(days, 5);
});

test("requests cannot span holiday years", () => {
  assert.equal(holidayYearForStartDate("2027-12-30"), 2027);
  assert.equal(holidayYearForStartDate("2028-01-02"), 2028);
});
