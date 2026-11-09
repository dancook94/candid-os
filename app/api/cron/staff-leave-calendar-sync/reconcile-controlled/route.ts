import { handleStaffLeaveControlledCalendarReconcileCron } from "@/lib/staff-leave/calendar-sync/controlled-reconcile-cron-http";

export const runtime = "nodejs";
export const maxDuration = 60;

export function GET(request: Request) {
  return handleStaffLeaveControlledCalendarReconcileCron(request);
}
