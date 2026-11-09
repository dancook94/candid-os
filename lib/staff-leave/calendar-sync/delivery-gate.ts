import { getStaffLeaveCalendarSyncConfig } from "@/lib/staff-leave/calendar-sync/config";
import type { StaffLeaveCalendarSyncProvider } from "@/lib/staff-leave/calendar-sync/kinds";

export type StaffLeaveCalendarDeliveryGate =
  | {
      allowed: true;
      provider: StaffLeaveCalendarSyncProvider;
      teamCalendarId: string;
      sicknessCalendarId: string;
      /** True when delivery is simulated (no Google API). */
      mockDelivery: boolean;
    }
  | {
      allowed: false;
      reason:
        | "calendar_sync_disabled"
        | "google_provider_not_configured"
        | "google_provider_not_implemented";
    };

/**
 * Fail closed: real Google sync stays off until explicitly enabled with provider=google
 * and credentials (Stage 3B+). Default provider is mock.
 */
export function getStaffLeaveCalendarDeliveryGate(): StaffLeaveCalendarDeliveryGate {
  const config = getStaffLeaveCalendarSyncConfig();

  if (!config.enabled) {
    return { allowed: false, reason: "calendar_sync_disabled" };
  }

  if (config.provider === "google") {
    const hasJson = Boolean(process.env.STAFF_LEAVE_GCAL_SERVICE_ACCOUNT_JSON?.trim());
    const hasTeamId = Boolean(process.env.STAFF_LEAVE_GCAL_TEAM_CALENDAR_ID?.trim());
    const hasSicknessId = Boolean(process.env.STAFF_LEAVE_GCAL_SICKNESS_CALENDAR_ID?.trim());

    if (!hasJson || !hasTeamId || !hasSicknessId) {
      return { allowed: false, reason: "google_provider_not_configured" };
    }

    return { allowed: false, reason: "google_provider_not_implemented" };
  }

  return {
    allowed: true,
    provider: "mock",
    teamCalendarId: config.teamCalendarId,
    sicknessCalendarId: config.sicknessCalendarId,
    mockDelivery: true,
  };
}
