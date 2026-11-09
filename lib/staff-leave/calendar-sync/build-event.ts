import { createHash } from "node:crypto";

import {
  getStaffLeaveCalendarHalfDayConfig,
  type StaffLeaveCalendarHalfDayConfig,
} from "@/lib/staff-leave/calendar-sync/config";
import {
  deterministicCalendarEventId,
  staffLeaveCalendarEntityKey,
} from "@/lib/staff-leave/calendar-sync/deterministic-event-id";
import type {
  StaffLeaveCalendarChannel,
  StaffLeaveCalendarEntityType,
} from "@/lib/staff-leave/calendar-sync/kinds";
import { formatLeaveKindLabel } from "@/lib/staff-leave/notifications/format";
import type { LeaveDayPortion, LeaveKind } from "@/lib/staff-leave/types";
import { formatIsoDateLocal, parseIsoDateLocal } from "@/lib/staff-leave/working-days";

function addDaysToIsoDate(isoDate: string, days: number) {
  const next = parseIsoDateLocal(isoDate);
  next.setDate(next.getDate() + days);
  return formatIsoDateLocal(next);
}

export type CalendarEventTimeShape =
  | { kind: "all_day"; startDate: string; endDateExclusive: string }
  | {
      kind: "timed";
      startDateTime: string;
      endDateTime: string;
    };

export type StaffLeaveCalendarEventPayload = {
  entityKey: string;
  eventId: string;
  calendarChannel: StaffLeaveCalendarChannel;
  entityType: StaffLeaveCalendarEntityType;
  entityId: string;
  summary: string;
  description: string;
  time: CalendarEventTimeShape;
  timeZone: "Europe/London";
  extendedProperties: {
    candid_entity_key: string;
    candid_entity_type: StaffLeaveCalendarEntityType;
    candid_entity_id: string;
    candid_channel: StaffLeaveCalendarChannel;
  };
  fingerprint: string;
};

export type LeaveRequestCalendarSource = {
  id: string;
  leaveKind: LeaveKind;
  startDate: string;
  endDate: string;
  dayPortion: LeaveDayPortion;
};

export type SicknessCalendarSource = {
  id: string;
  startDate: string;
  endDate: string;
  dayPortion: LeaveDayPortion;
};

function buildTimedWindow(
  isoDate: string,
  portion: "am" | "pm",
  halfDay: StaffLeaveCalendarHalfDayConfig
) {
  const window = portion === "am" ? halfDay.am : halfDay.pm;
  return {
    kind: "timed" as const,
    startDateTime: `${isoDate}T${window.start}:00`,
    endDateTime: `${isoDate}T${window.end}:00`,
  };
}

export function buildLeaveTimeShape(
  source: Pick<LeaveRequestCalendarSource, "startDate" | "endDate" | "dayPortion">,
  halfDay = getStaffLeaveCalendarHalfDayConfig()
): CalendarEventTimeShape {
  if (source.dayPortion === "am" || source.dayPortion === "pm") {
    return buildTimedWindow(source.startDate, source.dayPortion, halfDay);
  }

  const endExclusive = addDaysToIsoDate(source.endDate, 1);

  return {
    kind: "all_day",
    startDate: source.startDate,
    endDateExclusive: endExclusive,
  };
}

export function buildSicknessTimeShape(
  source: Pick<SicknessCalendarSource, "startDate" | "endDate" | "dayPortion">,
  halfDay = getStaffLeaveCalendarHalfDayConfig()
): CalendarEventTimeShape {
  return buildLeaveTimeShape(source, halfDay);
}

function fingerprintPayload(payload: Record<string, unknown>) {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

export function buildTeamLeaveCalendarEvent(input: {
  request: LeaveRequestCalendarSource;
  employeeName: string;
}): StaffLeaveCalendarEventPayload {
  const entityKey = staffLeaveCalendarEntityKey({
    calendarChannel: "team_leave",
    entityType: "leave_request",
    entityId: input.request.id,
  });

  const leaveLabel = formatLeaveKindLabel(input.request.leaveKind);
  const summary = `${input.employeeName} — ${leaveLabel}`;
  const time = buildLeaveTimeShape(input.request);

  const fingerprintSource = {
    summary,
    leaveKind: input.request.leaveKind,
    startDate: input.request.startDate,
    endDate: input.request.endDate,
    dayPortion: input.request.dayPortion,
    time,
  };

  return {
    entityKey,
    eventId: deterministicCalendarEventId(entityKey),
    calendarChannel: "team_leave",
    entityType: "leave_request",
    entityId: input.request.id,
    summary,
    description: `Candid OS leave request ${input.request.id}`,
    time,
    timeZone: "Europe/London",
    extendedProperties: {
      candid_entity_key: entityKey,
      candid_entity_type: "leave_request",
      candid_entity_id: input.request.id,
      candid_channel: "team_leave",
    },
    fingerprint: fingerprintPayload(fingerprintSource),
  };
}

export function buildSicknessCalendarEvent(input: {
  sickness: SicknessCalendarSource;
  employeeName: string;
}): StaffLeaveCalendarEventPayload {
  const entityKey = staffLeaveCalendarEntityKey({
    calendarChannel: "sickness_management",
    entityType: "sickness",
    entityId: input.sickness.id,
  });

  const summary = `${input.employeeName} — Absence`;
  const time = buildSicknessTimeShape(input.sickness);

  const fingerprintSource = {
    summary,
    startDate: input.sickness.startDate,
    endDate: input.sickness.endDate,
    dayPortion: input.sickness.dayPortion,
    time,
  };

  return {
    entityKey,
    eventId: deterministicCalendarEventId(entityKey),
    calendarChannel: "sickness_management",
    entityType: "sickness",
    entityId: input.sickness.id,
    summary,
    description: `Candid OS sickness record ${input.sickness.id}`,
    time,
    timeZone: "Europe/London",
    extendedProperties: {
      candid_entity_key: entityKey,
      candid_entity_type: "sickness",
      candid_entity_id: input.sickness.id,
      candid_channel: "sickness_management",
    },
    fingerprint: fingerprintPayload(fingerprintSource),
  };
}
