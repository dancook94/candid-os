import { handleStaffLeaveNotificationsCron } from "@/lib/staff-leave/notifications/cron-http";

export const runtime = "nodejs";
export const maxDuration = 60;

export function GET(request: Request) {
  return handleStaffLeaveNotificationsCron(request);
}
