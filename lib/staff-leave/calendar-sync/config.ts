import type { StaffLeaveCalendarSyncProvider } from "@/lib/staff-leave/calendar-sync/kinds";

export type HalfDayWindow = {
  start: string;
  end: string;
};

export type StaffLeaveCalendarHalfDayConfig = {
  am: HalfDayWindow;
  pm: HalfDayWindow;
};

export type StaffLeaveCalendarSyncConfig = {
  enabled: boolean;
  provider: StaffLeaveCalendarSyncProvider;
  teamCalendarId: string;
  sicknessCalendarId: string;
  timeZone: "Europe/London";
  halfDay: StaffLeaveCalendarHalfDayConfig;
};

const LONDON_TZ = "Europe/London" as const;

function readHalfDayWindow(
  startKey: string,
  endKey: string,
  defaults: HalfDayWindow
): HalfDayWindow {
  return {
    start: process.env[startKey]?.trim() || defaults.start,
    end: process.env[endKey]?.trim() || defaults.end,
  };
}

export function getStaffLeaveCalendarHalfDayConfig(): StaffLeaveCalendarHalfDayConfig {
  return {
    am: readHalfDayWindow(
      "STAFF_LEAVE_GCAL_AM_START",
      "STAFF_LEAVE_GCAL_AM_END",
      { start: "09:00", end: "13:00" }
    ),
    pm: readHalfDayWindow(
      "STAFF_LEAVE_GCAL_PM_START",
      "STAFF_LEAVE_GCAL_PM_END",
      { start: "13:00", end: "17:00" }
    ),
  };
}

export function getStaffLeaveCalendarSyncConfig(): StaffLeaveCalendarSyncConfig {
  const enabled = process.env.STAFF_LEAVE_GCAL_ENABLED?.trim().toLowerCase() === "true";
  const rawProvider = process.env.STAFF_LEAVE_GCAL_PROVIDER?.trim().toLowerCase() ?? "mock";

  const provider: StaffLeaveCalendarSyncProvider =
    rawProvider === "google" ? "google" : "mock";

  return {
    enabled,
    provider,
    teamCalendarId:
      process.env.STAFF_LEAVE_GCAL_TEAM_CALENDAR_ID?.trim() || "unconfigured-team-calendar",
    sicknessCalendarId:
      process.env.STAFF_LEAVE_GCAL_SICKNESS_CALENDAR_ID?.trim() ||
      "unconfigured-sickness-calendar",
    timeZone: LONDON_TZ,
    halfDay: getStaffLeaveCalendarHalfDayConfig(),
  };
}
