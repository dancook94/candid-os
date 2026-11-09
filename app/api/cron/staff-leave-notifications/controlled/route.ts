import { handleStaffLeaveControlledNotificationsCron } from "@/lib/staff-leave/notifications/controlled-cron-http";

export const runtime = "nodejs";
export const maxDuration = 60;

export function GET(request: Request) {
  return handleStaffLeaveControlledNotificationsCron(request);
}
