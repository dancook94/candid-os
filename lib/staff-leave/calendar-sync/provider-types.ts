import type { StaffLeaveCalendarEventPayload } from "@/lib/staff-leave/calendar-sync/build-event";
import type { StaffLeaveCalendarSyncProvider } from "@/lib/staff-leave/calendar-sync/kinds";

export type CalendarSyncUpsertResult = {
  provider: StaffLeaveCalendarSyncProvider;
  googleCalendarId: string;
  googleEventId: string;
  etag: string | null;
  /** False when using mock provider (not a real Google delivery). */
  deliveredToGoogle: boolean;
};

export type CalendarSyncProvider = {
  upsertEvent(
    calendarId: string,
    event: StaffLeaveCalendarEventPayload
  ): Promise<CalendarSyncUpsertResult>;
  deleteEvent(calendarId: string, eventId: string): Promise<{ deliveredToGoogle: boolean }>;
};
