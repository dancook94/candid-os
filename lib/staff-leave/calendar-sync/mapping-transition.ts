import type { StaffLeaveCalendarSyncProvider } from "@/lib/staff-leave/calendar-sync/kinds";

export type CalendarMappingRow = {
  sync_provider: string;
  deleted_at: string | null;
};

/**
 * When Live enables Google, mock mappings should be re-delivered through the real provider.
 */
export function mappingNeedsGoogleResync(
  mapping: CalendarMappingRow | null | undefined,
  targetProvider: StaffLeaveCalendarSyncProvider
) {
  if (!mapping || mapping.deleted_at) {
    return false;
  }

  return targetProvider === "google" && mapping.sync_provider === "mock";
}

export function describeSyncProviderLabel(provider: StaffLeaveCalendarSyncProvider | null) {
  if (provider === "mock") {
    return "Mock (not delivered to Google)";
  }

  if (provider === "google") {
    return "Google Calendar";
  }

  return "Not configured";
}
