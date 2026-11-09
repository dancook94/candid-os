import { dateInLeaveRange } from "@/lib/staff-leave/calendar";
import { isoDatesBetweenInclusive } from "@/lib/staff-leave/working-days";

export type OverlapRequest = {
  id: string;
  profileId: string;
  fullName: string | null;
  startDate: string;
  endDate: string;
  status: string;
};

export type OverlapWarning = {
  isoDate: string;
  requests: OverlapRequest[];
};

export function findOverlappingLeaveWarnings(
  requests: OverlapRequest[],
  holidayYear: number
) {
  const active = requests.filter(
    (request) =>
      request.status === "approved" || request.status === "pending"
  );

  const yearStart = `${holidayYear}-01-01`;
  const yearEnd = `${holidayYear}-12-31`;
  const days = isoDatesBetweenInclusive(yearStart, yearEnd);

  const warnings: OverlapWarning[] = [];

  for (const isoDate of days) {
    const onDay = active.filter((request) =>
      dateInLeaveRange(isoDate, request.startDate, request.endDate)
    );

    const distinctProfiles = new Set(onDay.map((row) => row.profileId));
    if (distinctProfiles.size >= 2) {
      warnings.push({ isoDate, requests: onDay });
    }
  }

  return warnings.slice(0, 30);
}
