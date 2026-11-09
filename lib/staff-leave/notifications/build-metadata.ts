import type { StaffLeaveOutboxKind } from "@/lib/staff-leave/notifications/kinds";
import {
  formatDaysRequested,
  formatLeaveDateRange,
  formatLeaveKindLabel,
} from "@/lib/staff-leave/notifications/format";

export type StaffLeaveRequestEmailContext = {
  requestId: string;
  leaveKind: string;
  status: string;
  startDate: string;
  endDate: string;
  daysRequested: number;
  employeeName: string;
};

export function buildStaffLeaveEmailMetadata(
  kind: StaffLeaveOutboxKind,
  context: StaffLeaveRequestEmailContext
): Record<string, unknown> {
  const leaveType = formatLeaveKindLabel(context.leaveKind);
  const dates = formatLeaveDateRange(context.startDate, context.endDate);
  const days = formatDaysRequested(context.daysRequested);

  const statusLabel = statusLabelForKind(kind, context.status);

  return {
    employeeName: context.employeeName,
    leaveType,
    leaveKind: context.leaveKind,
    dates,
    startDate: context.startDate,
    endDate: context.endDate,
    daysRequested: days,
    statusLabel,
    requestId: context.requestId,
    adminLeaveUrl: "/admin/leave",
    staffLeaveUrl: "/staff/leave",
  };
}

function statusLabelForKind(kind: StaffLeaveOutboxKind, requestStatus: string) {
  switch (kind) {
    case "management_annual_submitted":
    case "management_additional_paid_submitted":
      return "Pending approval";
    case "employee_approved":
    case "employee_additional_paid_granted":
      return "Approved";
    case "employee_declined":
      return "Declined";
    case "management_approved_cancelled":
      return "Cancelled";
    default:
      return requestStatus;
  }
}
