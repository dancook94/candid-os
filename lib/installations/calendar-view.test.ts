import assert from "node:assert/strict";
import test from "node:test";

import {
  bookingsForInstaller,
  bookingsOnDate,
  calendarDates,
  calendarHeading,
  isCalendarBooking,
  setCalendarMonth,
  setCalendarYear,
  stepCalendar,
  unassignedBookings,
  visibleStaff,
  WEEKDAY_LABELS,
  type CalendarBooking,
} from "@/lib/installations/calendar-view";
import { londonDateKey } from "@/lib/installations/labels";

const assigned: CalendarBooking = {
  visitId: "visit-shared",
  projectId: "project-1",
  jobReference: "J-12",
  label: "Northwind signs",
  status: "scheduled",
  scheduledStartAt: "2026-11-18T09:00:00.000Z",
  assigneeIds: ["installer-a", "installer-b"],
  assigneeNames: ["Alex", "Sam"],
};

const unassigned: CalendarBooking = {
  visitId: "visit-open",
  projectId: "project-2",
  jobReference: "J-13",
  label: "Harbour boards",
  status: "scheduled",
  scheduledStartAt: "2026-11-18T14:00:00.000Z",
  assigneeIds: [],
  assigneeNames: [],
};

const bookings = [assigned, unassigned];

test("a scheduled visit without an installer stays on the calendar", () => {
  assert.equal(isCalendarBooking({ scheduledStartAt: null, status: "scheduled" }), false);
  assert.equal(isCalendarBooking({ scheduledStartAt: "2026-11-18T09:00:00.000Z", status: "cancelled" }), false);
  assert.equal(isCalendarBooking({ scheduledStartAt: "2026-11-18T09:00:00.000Z", status: "scheduled" }), true);
  assert.deepEqual(
    unassignedBookings(bookings, "2026-11-18").map((booking) => booking.visitId),
    ["visit-open"]
  );
  assert.equal(bookingsForInstaller(bookings, "installer-a", "2026-11-18").some((booking) => booking.visitId === "visit-open"), false);
});

test("one visit is shown on every assigned installer and once in the month", () => {
  const alex = bookingsForInstaller(bookings, "installer-a", "2026-11-18");
  const sam = bookingsForInstaller(bookings, "installer-b", "2026-11-18");
  assert.deepEqual(alex.map((booking) => booking.visitId), ["visit-shared"]);
  assert.deepEqual(sam.map((booking) => booking.visitId), ["visit-shared"]);
  assert.equal(alex[0]?.visitId, sam[0]?.visitId);

  const monthVisits = bookingsOnDate(bookings, "2026-11-18");
  assert.equal(new Set(monthVisits.map((booking) => booking.visitId)).size, monthVisits.length);
  assert.equal(monthVisits.length, 2);
});

test("day, week and month include the booking and start on Monday", () => {
  assert.deepEqual(WEEKDAY_LABELS[0], "Mon");
  assert.deepEqual(WEEKDAY_LABELS[6], "Sun");
  assert.deepEqual(calendarDates("day", "2026-11-18"), ["2026-11-18"]);

  const week = calendarDates("week", "2026-11-18");
  assert.deepEqual(week, [
    "2026-11-16",
    "2026-11-17",
    "2026-11-18",
    "2026-11-19",
    "2026-11-20",
    "2026-11-21",
    "2026-11-22",
  ]);
  assert.equal(new Date(`${week[0]}T00:00:00Z`).getUTCDay(), 1);
  assert.equal(new Date(`${week[6]}T00:00:00Z`).getUTCDay(), 0);

  const month = calendarDates("month", "2026-11-18");
  assert.equal(month[0], "2026-10-26");
  assert.equal(new Date(`${month[0]}T00:00:00Z`).getUTCDay(), 1);
  assert.equal(month.includes("2026-11-18"), true);
  assert.equal(new Date(`${month[month.length - 1]}T00:00:00Z`).getUTCDay(), 0);
});

test("month and year changes jump without walking day by day", () => {
  assert.equal(stepCalendar("month", "2026-11-18", 1), "2026-12-18");
  assert.equal(stepCalendar("month", "2026-01-31", 1), "2026-02-28");
  assert.equal(stepCalendar("week", "2026-11-18", -1), "2026-11-11");
  assert.equal(stepCalendar("day", "2026-11-18", 1), "2026-11-19");
  assert.equal(setCalendarMonth("2026-11-18", 3), "2026-03-18");
  assert.equal(setCalendarYear("2026-11-18", 2027), "2027-11-18");
  assert.equal(calendarHeading("2026-11-18"), "November 2026");
});

test("an empty staff filter shows every installer", () => {
  const people = [{ id: "installer-a" }, { id: "installer-b" }];
  assert.equal(visibleStaff(people, new Set()).length, 2);
  assert.deepEqual(visibleStaff(people, new Set(["installer-b"])).map((person) => person.id), ["installer-b"]);
});

test("London dates keep a late summer booking on the next morning", () => {
  assert.equal(londonDateKey("2026-06-10T23:30:00.000Z"), "2026-06-11");
  assert.equal(londonDateKey("2026-11-18T09:00:00.000Z"), "2026-11-18");
});
