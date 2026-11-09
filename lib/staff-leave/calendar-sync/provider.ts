import { createMockCalendarSyncProvider } from "@/lib/staff-leave/calendar-sync/mock-provider";
import type { StaffLeaveCalendarSyncProvider } from "@/lib/staff-leave/calendar-sync/kinds";
import type { CalendarSyncProvider } from "@/lib/staff-leave/calendar-sync/provider-types";

export function createStaffLeaveCalendarSyncProvider(
  provider: StaffLeaveCalendarSyncProvider
): CalendarSyncProvider {
  if (provider === "mock") {
    return createMockCalendarSyncProvider();
  }

  throw new Error("google_calendar_provider_not_implemented");
}
