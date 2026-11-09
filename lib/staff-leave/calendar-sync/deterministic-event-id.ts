import { createHash } from "node:crypto";

import type {
  StaffLeaveCalendarChannel,
  StaffLeaveCalendarEntityType,
} from "@/lib/staff-leave/calendar-sync/kinds";

const GCAL_EVENT_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuv";

/**
 * Stable key for mapping rows and provider idempotency.
 */
export function staffLeaveCalendarEntityKey(input: {
  calendarChannel: StaffLeaveCalendarChannel;
  entityType: StaffLeaveCalendarEntityType;
  entityId: string;
}) {
  return `${input.calendarChannel}:${input.entityType}:${input.entityId}`;
}

/**
 * Deterministic Calendar API–compatible event id (base32hex [a-v0-9], length >= 5).
 * Used for insert idempotency and mapping recovery after timeouts.
 */
export function deterministicCalendarEventId(entityKey: string) {
  const digest = createHash("sha256").update(entityKey).digest();
  let id = "cnd";

  for (let i = 0; i < 20; i += 1) {
    id += GCAL_EVENT_ID_ALPHABET[digest[i]! % 32];
  }

  return id;
}
