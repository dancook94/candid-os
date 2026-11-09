import { handleStaffLeaveControlledCalendarSyncCron } from "@/lib/staff-leave/calendar-sync/controlled-cron-http";

export const runtime = "nodejs";
export const maxDuration = 60;

export function GET(request: Request) {
  return handleStaffLeaveControlledCalendarSyncCron(request);
}
