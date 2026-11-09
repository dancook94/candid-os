import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSicknessCalendarEvent,
  buildTeamLeaveCalendarEvent,
} from "@/lib/staff-leave/calendar-sync/build-event";

test("team leave all-day event uses exclusive end date", () => {
  const event = buildTeamLeaveCalendarEvent({
    request: {
      id: "req-1",
      leaveKind: "annual",
      startDate: "2027-06-07",
      endDate: "2027-06-09",
      dayPortion: "full",
    },
    employeeName: "Alex Example",
  });

  assert.equal(event.time.kind, "all_day");
  if (event.time.kind === "all_day") {
    assert.equal(event.time.startDate, "2027-06-07");
    assert.equal(event.time.endDateExclusive, "2027-06-10");
  }

  assert.match(event.summary, /Alex Example/);
  assert.match(event.summary, /Annual leave/);
  assert.doesNotMatch(event.description, /note/i);
});

test("half-day leave uses configurable timed windows", () => {
  const previousAmStart = process.env.STAFF_LEAVE_GCAL_AM_START;
  const previousAmEnd = process.env.STAFF_LEAVE_GCAL_AM_END;
  process.env.STAFF_LEAVE_GCAL_AM_START = "08:30";
  process.env.STAFF_LEAVE_GCAL_AM_END = "12:30";

  try {
    const event = buildTeamLeaveCalendarEvent({
      request: {
        id: "req-2",
        leaveKind: "additional_paid",
        startDate: "2027-07-01",
        endDate: "2027-07-01",
        dayPortion: "am",
      },
      employeeName: "Blair Example",
    });

    assert.equal(event.time.kind, "timed");
    if (event.time.kind === "timed") {
      assert.equal(event.time.startDateTime, "2027-07-01T08:30:00");
      assert.equal(event.time.endDateTime, "2027-07-01T12:30:00");
    }
  } finally {
    if (previousAmStart === undefined) {
      delete process.env.STAFF_LEAVE_GCAL_AM_START;
    } else {
      process.env.STAFF_LEAVE_GCAL_AM_START = previousAmStart;
    }

    if (previousAmEnd === undefined) {
      delete process.env.STAFF_LEAVE_GCAL_AM_END;
    } else {
      process.env.STAFF_LEAVE_GCAL_AM_END = previousAmEnd;
    }
  }
});

test("sickness events include employee name only", () => {
  const event = buildSicknessCalendarEvent({
    sickness: {
      id: "sick-1",
      startDate: "2027-08-12",
      endDate: "2027-08-12",
      dayPortion: "pm",
    },
    employeeName: "Casey Example",
  });

  assert.equal(event.summary, "Casey Example — Absence");
  assert.equal(event.calendarChannel, "sickness_management");
  assert.doesNotMatch(event.summary, /flu|injury|medical/i);
});
