import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildLeaveCalendarHref,
  leaveCalendarYearOptions,
  londonYearMonthNow,
  parseYearMonth,
} from "@/lib/staff-leave/calendar";

describe("leave calendar navigation", () => {
  it("resolves the London calendar month for a fixed instant", () => {
    assert.deepEqual(londonYearMonthNow(new Date("2026-11-09T12:00:00Z")), {
      year: 2026,
      month: 11,
    });
  });

  it("falls back to London today when query params are invalid", () => {
    const now = londonYearMonthNow();
    assert.deepEqual(parseYearMonth({ year: "not-a-year", month: "13" }), now);
  });

  it("honours explicit year and month query params", () => {
    assert.deepEqual(parseYearMonth({ year: "2028", month: "3" }), { year: 2028, month: 3 });
  });

  it("builds calendar URLs with month and year params", () => {
    assert.equal(
      buildLeaveCalendarHref("/staff/leave", 2026, 11),
      "/staff/leave?year=2026&month=11"
    );
  });

  it("provides a sliding window of year options", () => {
    const options = leaveCalendarYearOptions(2026);
    assert.deepEqual(options, [2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031]);
  });
});
