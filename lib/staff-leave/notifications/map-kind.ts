import type { InternalNotificationType, StaffNotificationType } from "@/lib/notifications/notification-types";
import type { StaffLeaveOutboxKind } from "@/lib/staff-leave/notifications/kinds";

export type StaffLeaveNotificationTarget =
  | { audience: "internal"; type: InternalNotificationType }
  | { audience: "staff"; type: StaffNotificationType };

export function mapOutboxKindToNotificationType(
  kind: StaffLeaveOutboxKind
): StaffLeaveNotificationTarget {
  switch (kind) {
    case "management_annual_submitted":
      return {
        audience: "internal",
        type: "internal_staff_leave_annual_request",
      };
    case "management_additional_paid_submitted":
      return {
        audience: "internal",
        type: "internal_staff_leave_additional_paid_request",
      };
    case "management_approved_cancelled":
      return {
        audience: "internal",
        type: "internal_staff_leave_cancelled_approved",
      };
    case "employee_approved":
      return { audience: "staff", type: "staff_leave_request_approved" };
    case "employee_declined":
      return { audience: "staff", type: "staff_leave_request_declined" };
    case "employee_additional_paid_granted":
      return { audience: "staff", type: "staff_leave_additional_paid_granted" };
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unsupported staff leave outbox kind: ${exhaustive}`);
    }
  }
}

export function staffLeaveNotificationIdempotencyKey(sourceEventId: string) {
  return `staff-leave:event:${sourceEventId}`;
}
