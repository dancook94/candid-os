import type {
  BankHolidayDate,
  CompanyClosureDate,
  LeaveBalanceSnapshot,
  WorkingPatternWeek,
} from "@/lib/staff-leave/types";
import {
  countReservedPoolDays,
  DEFAULT_MON_FRI_PATTERN,
  holidayYearForStartDate,
} from "@/lib/staff-leave/working-days";

export type LeaveRequestDayRow = {
  id?: string;
  startDate: string;
  endDate: string;
  daysRequested: number;
  status: "pending" | "approved" | "rejected" | "cancelled";
  leaveKind?: "annual" | "additional_paid";
};

export function roundLeaveDays(value: number) {
  return Math.round(value * 100) / 100;
}

export function proRataEntitlementDays(input: {
  grossPolicyDays: number;
  reservedPoolDays: number;
  fteRatio: number;
  adjustmentDays: number;
  prorataStartDate?: string | null;
  holidayYear: number;
}) {
  const bookableBeforeProrata = Math.max(
    0,
    input.grossPolicyDays - input.reservedPoolDays
  );
  let entitlement = bookableBeforeProrata * input.fteRatio + input.adjustmentDays;

  if (input.prorataStartDate) {
    const startYear = holidayYearForStartDate(input.prorataStartDate);
    if (startYear === input.holidayYear) {
      const start = new Date(input.prorataStartDate);
      const yearStart = new Date(input.holidayYear, 0, 1);
      const yearEnd = new Date(input.holidayYear, 11, 31);
      const totalDays =
        Math.floor((yearEnd.getTime() - yearStart.getTime()) / 86_400_000) + 1;
      const remainingDays =
        Math.floor((yearEnd.getTime() - start.getTime()) / 86_400_000) + 1;
      const fraction = Math.min(1, Math.max(0, remainingDays / totalDays));
      entitlement *= fraction;
    }
  }

  return roundLeaveDays(entitlement);
}

export function calculateReservedPoolDays(input: {
  bankHolidays: BankHolidayDate[];
  companyClosures: CompanyClosureDate[];
  pattern?: WorkingPatternWeek;
}) {
  return countReservedPoolDays({
    bankHolidays: input.bankHolidays,
    companyClosures: input.companyClosures,
    pattern: input.pattern ?? DEFAULT_MON_FRI_PATTERN,
  });
}

export function calculateLeaveBalance(input: {
  holidayYear: number;
  grossPolicyDays: number;
  bankHolidays: BankHolidayDate[];
  companyClosures: CompanyClosureDate[];
  fteRatio: number;
  adjustmentDays: number;
  prorataStartDate?: string | null;
  requests: LeaveRequestDayRow[];
  pattern?: WorkingPatternWeek;
}): LeaveBalanceSnapshot {
  const reservedPoolDays = calculateReservedPoolDays({
    bankHolidays: input.bankHolidays,
    companyClosures: input.companyClosures,
    pattern: input.pattern,
  });

  const entitlementDays = proRataEntitlementDays({
    grossPolicyDays: input.grossPolicyDays,
    reservedPoolDays,
    fteRatio: input.fteRatio,
    adjustmentDays: input.adjustmentDays,
    prorataStartDate: input.prorataStartDate,
    holidayYear: input.holidayYear,
  });

  let usedApprovedDays = 0;
  let pendingDays = 0;

  for (const request of input.requests) {
    if (holidayYearForStartDate(request.startDate) !== input.holidayYear) {
      continue;
    }

    if (request.leaveKind === "additional_paid") {
      continue;
    }

    if (request.status === "approved") {
      usedApprovedDays += request.daysRequested;
    }

    if (request.status === "pending") {
      pendingDays += request.daysRequested;
    }
  }

  usedApprovedDays = roundLeaveDays(usedApprovedDays);
  pendingDays = roundLeaveDays(pendingDays);

  const remainingDays = roundLeaveDays(
    entitlementDays - usedApprovedDays - pendingDays
  );

  return {
    holidayYear: input.holidayYear,
    entitlementDays,
    adjustmentDays: roundLeaveDays(input.adjustmentDays),
    usedApprovedDays,
    pendingDays,
    remainingDays,
    grossPolicyDays: input.grossPolicyDays,
    reservedPoolDays,
  };
}

/**
 * Headroom for approving one pending annual request: excludes that request's pending
 * days so they are not double-counted against the allowance.
 */
export function annualApprovalHeadroom(input: {
  holidayYear: number;
  entitlementDays: number;
  requests: LeaveRequestDayRow[];
  excludeRequestId: string;
}) {
  let approvedDays = 0;
  let otherPendingDays = 0;

  for (const request of input.requests) {
    if (holidayYearForStartDate(request.startDate) !== input.holidayYear) {
      continue;
    }
    if (request.leaveKind === "additional_paid") {
      continue;
    }
    if (request.status === "approved") {
      approvedDays += request.daysRequested;
    } else if (request.status === "pending" && request.id !== input.excludeRequestId) {
      otherPendingDays += request.daysRequested;
    }
  }

  return roundLeaveDays(
    input.entitlementDays - roundLeaveDays(approvedDays) - roundLeaveDays(otherPendingDays)
  );
}

export function canApproveAnnualRequest(input: {
  holidayYear: number;
  entitlementDays: number;
  requests: LeaveRequestDayRow[];
  requestId: string;
  requestDays: number;
}) {
  const headroom = annualApprovalHeadroom({
    holidayYear: input.holidayYear,
    entitlementDays: input.entitlementDays,
    requests: input.requests,
    excludeRequestId: input.requestId,
  });
  return { headroom, canApprove: input.requestDays <= headroom };
}
