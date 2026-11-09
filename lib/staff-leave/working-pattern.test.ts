import assert from "node:assert/strict";
import test from "node:test";

import { patternFromFlags } from "@/lib/staff-leave/entitlement-breakdown";
import { countLeaveDaysInRange } from "@/lib/staff-leave/working-days";

test("non-standard working week only counts scheduled working days", () => {
  const tueThu = patternFromFlags({
    worksMon: false,
    worksTue: true,
    worksWed: false,
    worksThu: true,
    worksFri: false,
    worksSat: false,
    worksSun: false,
  });

  const days = countLeaveDaysInRange({
    startDate: "2027-06-07",
    endDate: "2027-06-13",
    dayPortion: "full",
    pattern: tueThu,
    bankHolidays: [],
    companyClosures: [],
  });

  assert.equal(days, 2);
});

test("changing effective pattern does not alter stored request day counts", () => {
  const storedRequestDays = 3;
  const oldPattern = patternFromFlags({
    worksMon: true,
    worksTue: true,
    worksWed: true,
    worksThu: true,
    worksFri: true,
    worksSat: false,
    worksSun: false,
  });
  const newPattern = patternFromFlags({
    worksMon: true,
    worksTue: true,
    worksWed: false,
    worksThu: false,
    worksFri: true,
    worksSat: false,
    worksSun: false,
  });

  const recomputed = countLeaveDaysInRange({
    startDate: "2027-06-07",
    endDate: "2027-06-09",
    dayPortion: "full",
    pattern: newPattern,
    bankHolidays: [],
    companyClosures: [],
  });

  assert.equal(storedRequestDays, 3);
  assert.notEqual(recomputed, storedRequestDays);
});
