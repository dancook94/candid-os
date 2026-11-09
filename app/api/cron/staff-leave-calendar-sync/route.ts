import { handleStaffLeaveCalendarSyncCron } from "@/lib/staff-leave/calendar-sync/cron-http";

export const runtime = "nodejs";
export const maxDuration = 60;

export function GET(request: Request) {
  return handleStaffLeaveCalendarSyncCron(request);
}
