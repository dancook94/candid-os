import assert from "node:assert/strict";
import test from "node:test";

import {
  deterministicCalendarEventId,
  staffLeaveCalendarEntityKey,
} from "@/lib/staff-leave/calendar-sync/deterministic-event-id";

test("entity keys are stable", () => {
  const key = staffLeaveCalendarEntityKey({
    calendarChannel: "team_leave",
    entityType: "leave_request",
    entityId: "11111111-1111-1111-1111-111111111111",
  });

  assert.equal(key, "team_leave:leave_request:11111111-1111-1111-1111-111111111111");
});

test("deterministic event ids are stable and calendar-id shaped", () => {
  const key = staffLeaveCalendarEntityKey({
    calendarChannel: "sickness_management",
    entityType: "sickness",
    entityId: "22222222-2222-2222-2222-222222222222",
  });

  const first = deterministicCalendarEventId(key);
  const second = deterministicCalendarEventId(key);

  assert.equal(first, second);
  assert.match(first, /^cnd[0-9a-v]{20}$/);
});
