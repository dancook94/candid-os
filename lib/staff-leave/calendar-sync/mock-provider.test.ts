import assert from "node:assert/strict";
import test from "node:test";

import { buildTeamLeaveCalendarEvent } from "@/lib/staff-leave/calendar-sync/build-event";
import {
  createMockCalendarSyncProvider,
  getMockCalendarEvent,
  getMockCalendarStoreSize,
  resetMockCalendarStore,
} from "@/lib/staff-leave/calendar-sync/mock-provider";

test("mock provider stores events without marking google delivery", async () => {
  resetMockCalendarStore();

  const provider = createMockCalendarSyncProvider();
  const event = buildTeamLeaveCalendarEvent({
    request: {
      id: "req-mock-1",
      leaveKind: "annual",
      startDate: "2027-09-01",
      endDate: "2027-09-01",
      dayPortion: "full",
    },
    employeeName: "Alex Example",
  });

  const result = await provider.upsertEvent("mock-team-calendar", event);

  assert.equal(result.provider, "mock");
  assert.equal(result.deliveredToGoogle, false);
  assert.equal(result.googleEventId, event.eventId);
  assert.equal(getMockCalendarStoreSize(), 1);
  assert.ok(getMockCalendarEvent("mock-team-calendar", event.eventId));

  const deleted = await provider.deleteEvent("mock-team-calendar", event.eventId);
  assert.equal(deleted.deliveredToGoogle, false);
  assert.equal(getMockCalendarStoreSize(), 0);
});
