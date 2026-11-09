export type OverlapLeaveRow = {
  id?: string;
  startDate: string;
  endDate: string;
  status: string;
  leaveKind?: string;
};

const BLOCKING_STATUSES = new Set(["pending", "approved"]);

export function leaveRangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
) {
  return startA <= endB && startB <= endA;
}

/**
 * Mirrors staff_leave_has_blocking_overlap: any pending/approved leave blocks the range,
 * across annual and additional paid kinds.
 */
export function hasBlockingLeaveOverlap(
  requests: OverlapLeaveRow[],
  startDate: string,
  endDate: string,
  excludeId?: string
) {
  return requests.some(
    (request) =>
      (!excludeId || request.id !== excludeId) &&
      BLOCKING_STATUSES.has(request.status) &&
      leaveRangesOverlap(startDate, endDate, request.startDate, request.endDate)
  );
}
