import type { BankHolidayDate, CompanyClosureDate, LeaveDayPortion, WorkingPatternWeek } from "@/lib/staff-leave/types";
import { STAFF_LEAVE_FIRST_POLICY_YEAR } from "@/lib/staff-leave/types";
import {
  countLeaveDaysInRange,
  holidayYearForStartDate,
  rangesOverlap,
} from "@/lib/staff-leave/working-days";
import { calculateLeaveBalance, type LeaveRequestDayRow, roundLeaveDays } from "@/lib/staff-leave/balance";

export function validateLeaveRequestSubmission(input: {
  startDate: string;
  endDate: string;
  dayPortion: LeaveDayPortion;
  bankHolidays: BankHolidayDate[];
  companyClosures: CompanyClosureDate[];
  pattern: WorkingPatternWeek;
  grossPolicyDays: number;
  fteRatio: number;
  adjustmentDays: number;
  prorataStartDate?: string | null;
  existingRequests: LeaveRequestDayRow[];
  excludeRequestId?: string;
}) {
  if (input.endDate < input.startDate) {
    return { ok: false as const, code: "invalid_range", message: "End date must be on or after start date." };
  }

  const year = holidayYearForStartDate(input.startDate);
  if (year < STAFF_LEAVE_FIRST_POLICY_YEAR) {
    return {
      ok: false as const,
      code: "before_policy_year",
      message: `Leave requests are available from ${STAFF_LEAVE_FIRST_POLICY_YEAR}.`,
    };
  }

  if (holidayYearForStartDate(input.endDate) !== year) {
    return {
      ok: false as const,
      code: "crosses_year",
      message: "A single request cannot cross holiday years.",
    };
  }

  if (input.dayPortion !== "full" && input.startDate !== input.endDate) {
    return {
      ok: false as const,
      code: "half_day_range",
      message: "Half-day leave must use the same start and end date.",
    };
  }

  let daysRequested: number;
  try {
    daysRequested = countLeaveDaysInRange({
      startDate: input.startDate,
      endDate: input.endDate,
      dayPortion: input.dayPortion,
      pattern: input.pattern,
      bankHolidays: input.bankHolidays,
      companyClosures: input.companyClosures,
    });
  } catch {
    return {
      ok: false as const,
      code: "half_day_range",
      message: "Half-day leave must use the same start and end date.",
    };
  }

  if (daysRequested <= 0) {
    return {
      ok: false as const,
      code: "no_working_days",
      message: "The selected dates do not include any bookable working days.",
    };
  }

  for (const existing of input.existingRequests) {
    if (existing.status !== "pending" && existing.status !== "approved") {
      continue;
    }

    if (input.excludeRequestId && existing.id === input.excludeRequestId) {
      continue;
    }

    if (
      rangesOverlap(input.startDate, input.endDate, existing.startDate, existing.endDate)
    ) {
      return {
        ok: false as const,
        code: "overlapping_request",
        message: "These dates overlap an existing pending or approved request.",
      };
    }
  }

  const balance = calculateLeaveBalance({
    holidayYear: year,
    grossPolicyDays: input.grossPolicyDays,
    bankHolidays: input.bankHolidays,
    companyClosures: input.companyClosures,
    fteRatio: input.fteRatio,
    adjustmentDays: input.adjustmentDays,
    prorataStartDate: input.prorataStartDate,
    requests: input.existingRequests,
    pattern: input.pattern,
  });

  if (roundLeaveDays(balance.remainingDays - daysRequested) < 0) {
    return {
      ok: false as const,
      code: "insufficient_balance",
      message: "Insufficient remaining leave balance.",
      balance,
    };
  }

  return {
    ok: true as const,
    daysRequested: roundLeaveDays(daysRequested),
    holidayYear: year,
    balance,
  };
}
