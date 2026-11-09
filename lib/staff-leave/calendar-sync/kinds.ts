export const STAFF_LEAVE_CALENDAR_CHANNELS = ["team_leave", "sickness_management"] as const;
export type StaffLeaveCalendarChannel = (typeof STAFF_LEAVE_CALENDAR_CHANNELS)[number];

export const STAFF_LEAVE_CALENDAR_OPERATIONS = ["upsert", "delete"] as const;
export type StaffLeaveCalendarOperation = (typeof STAFF_LEAVE_CALENDAR_OPERATIONS)[number];

export const STAFF_LEAVE_CALENDAR_SOURCE_KINDS = [
  "leave_approved",
  "leave_cancelled_approved",
  "sickness_recorded",
  "reconcile_team_leave_upsert",
  "reconcile_team_leave_delete",
  "reconcile_sickness_upsert",
  "reconcile_google_refresh",
] as const;
export type StaffLeaveCalendarSourceKind = (typeof STAFF_LEAVE_CALENDAR_SOURCE_KINDS)[number];

export const STAFF_LEAVE_CALENDAR_RECONCILE_SOURCE_KINDS = [
  "reconcile_team_leave_upsert",
  "reconcile_team_leave_delete",
  "reconcile_sickness_upsert",
  "reconcile_google_refresh",
] as const;

export function isStaffLeaveCalendarReconcileSourceKind(value: string) {
  return (STAFF_LEAVE_CALENDAR_RECONCILE_SOURCE_KINDS as readonly string[]).includes(value);
}

export const STAFF_LEAVE_CALENDAR_ENTITY_TYPES = ["leave_request", "sickness"] as const;
export type StaffLeaveCalendarEntityType = (typeof STAFF_LEAVE_CALENDAR_ENTITY_TYPES)[number];

export const STAFF_LEAVE_CALENDAR_SYNC_PROVIDERS = ["mock", "google"] as const;
export type StaffLeaveCalendarSyncProvider = (typeof STAFF_LEAVE_CALENDAR_SYNC_PROVIDERS)[number];

export function isStaffLeaveCalendarChannel(
  value: string
): value is StaffLeaveCalendarChannel {
  return (STAFF_LEAVE_CALENDAR_CHANNELS as readonly string[]).includes(value);
}

export function isStaffLeaveCalendarOperation(
  value: string
): value is StaffLeaveCalendarOperation {
  return (STAFF_LEAVE_CALENDAR_OPERATIONS as readonly string[]).includes(value);
}
