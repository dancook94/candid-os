import { londonTodayIso } from "@/lib/staff-leave/calendar";
import type { LeaveRequestStatus } from "@/lib/staff-leave/types";

export { londonTodayIso };

const CANCELLABLE_STATUSES: LeaveRequestStatus[] = ["pending", "approved"];

export function leaveHasStartedInLondon(startDate: string, londonToday = londonTodayIso()) {
  return startDate <= londonToday;
}

export type LeaveCancellationEligibility =
  | { canCancel: true; requiresReason: boolean }
  | {
      canCancel: false;
      reason: "invalid_status" | "forbidden" | "started_requires_management";
    };

export function evaluateLeaveCancellationEligibility(input: {
  status: LeaveRequestStatus | string;
  startDate: string;
  actorProfileId: string;
  ownerProfileId: string;
  isApprovedAdmin: boolean;
  londonToday?: string;
}): LeaveCancellationEligibility {
  const londonToday = input.londonToday ?? londonTodayIso();
  const status = input.status as LeaveRequestStatus;

  if (!CANCELLABLE_STATUSES.includes(status)) {
    return { canCancel: false, reason: "invalid_status" };
  }

  const isOwner = input.actorProfileId === input.ownerProfileId;

  if (!isOwner && !input.isApprovedAdmin) {
    return { canCancel: false, reason: "forbidden" };
  }

  if (status === "pending") {
    return { canCancel: true, requiresReason: false };
  }

  const started = leaveHasStartedInLondon(input.startDate, londonToday);

  if (started) {
    if (!input.isApprovedAdmin) {
      return { canCancel: false, reason: "started_requires_management" };
    }
    return { canCancel: true, requiresReason: true };
  }

  return { canCancel: true, requiresReason: false };
}

/** @deprecated Use evaluateLeaveCancellationEligibility for UI and tests. */
export function canCancelLeaveRequest(input: {
  status: LeaveRequestStatus;
  actorProfileId: string;
  ownerProfileId: string;
  isApprovedAdmin: boolean;
  startDate?: string;
  londonToday?: string;
}) {
  const result = evaluateLeaveCancellationEligibility({
    status: input.status,
    startDate: input.startDate ?? "9999-12-31",
    actorProfileId: input.actorProfileId,
    ownerProfileId: input.ownerProfileId,
    isApprovedAdmin: input.isApprovedAdmin,
    londonToday: input.londonToday,
  });

  if (!result.canCancel) {
    if (result.reason === "started_requires_management") {
      return { ok: false as const, reason: "started_requires_management" as const };
    }
    return { ok: false as const, reason: result.reason };
  }

  return { ok: true as const, requiresReason: result.requiresReason };
}

export function isLeaveRequestCancellable(status: string) {
  return status === "pending" || status === "approved";
}
