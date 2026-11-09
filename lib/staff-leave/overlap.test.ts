import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findOverlappingLeaveWarnings } from "@/lib/staff-leave/overlap";

describe("findOverlappingLeaveWarnings", () => {
  it("flags days with two or more active requests", () => {
    const warnings = findOverlappingLeaveWarnings(
      [
        {
          id: "a",
          profileId: "p1",
          fullName: "Alice",
          startDate: "2027-06-01",
          endDate: "2027-06-03",
          status: "approved",
        },
        {
          id: "b",
          profileId: "p2",
          fullName: "Bob",
          startDate: "2027-06-02",
          endDate: "2027-06-02",
          status: "pending",
        },
      ],
      2027
    );

    assert.ok(warnings.some((warning) => warning.isoDate === "2027-06-02"));
    assert.equal(warnings.find((warning) => warning.isoDate === "2027-06-02")?.requests.length, 2);
  });

  it("ignores rejected requests", () => {
    const warnings = findOverlappingLeaveWarnings(
      [
        {
          id: "a",
          profileId: "p1",
          fullName: "Alice",
          startDate: "2027-06-01",
          endDate: "2027-06-01",
          status: "rejected",
        },
        {
          id: "b",
          profileId: "p2",
          fullName: "Bob",
          startDate: "2027-06-01",
          endDate: "2027-06-01",
          status: "approved",
        },
      ],
      2027
    );

    assert.equal(warnings.length, 0);
  });
});
