import type { StaffLeaveCalendarOperation } from "@/lib/staff-leave/calendar-sync/kinds";

export type SourceStateDiscardReason =
  | "upsert_requires_approved_leave"
  | "delete_requires_cancelled_leave"
  | "upsert_missing_sickness"
  | "delete_not_supported_for_sickness";

export type SourceStateVerdict =
  | { ok: true }
  | { ok: false; action: "discard"; reason: SourceStateDiscardReason };

export type LeaveRequestStateRow = {
  status: string;
  leave_kind: string;
};

export function validateLeaveCalendarOperation(
  operation: StaffLeaveCalendarOperation,
  request: LeaveRequestStateRow
): SourceStateVerdict {
  if (operation === "upsert") {
    if (request.status !== "approved") {
      return { ok: false, action: "discard", reason: "upsert_requires_approved_leave" };
    }

    return { ok: true };
  }

  if (operation === "delete") {
    if (request.status !== "cancelled") {
      return { ok: false, action: "discard", reason: "delete_requires_cancelled_leave" };
    }

    return { ok: true };
  }

  return { ok: false, action: "discard", reason: "upsert_requires_approved_leave" };
}

export function validateSicknessCalendarOperation(
  operation: StaffLeaveCalendarOperation
): SourceStateVerdict {
  if (operation === "upsert") {
    return { ok: true };
  }

  return { ok: false, action: "discard", reason: "delete_not_supported_for_sickness" };
}
