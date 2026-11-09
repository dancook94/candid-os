import type { BankHolidayDate, CompanyClosureDate, WorkingPatternWeek } from "@/lib/staff-leave/types";
import {
  countNonBookableClosureDays,
  countReservedPoolDays,
  DEFAULT_MON_FRI_PATTERN,
  isWorkingDayOnPattern,
} from "@/lib/staff-leave/working-days";
import { proRataEntitlementDays, roundLeaveDays } from "@/lib/staff-leave/balance";

export type EntitlementBreakdown = {
  grossAllowanceDays: number;
  bankHolidaysOnWorkingDays: number;
  compulsoryClosuresOnWorkingDays: number;
  paidGiftClosuresOnWorkingDays: number;
  reservedPoolDays: number;
  fteRatio: number;
  adjustmentDays: number;
  prorataStartDate: string | null;
  bookableEntitlementDays: number;
};

export function countBankHolidaysOnWorkingDays(input: {
  bankHolidays: BankHolidayDate[];
  pattern: WorkingPatternWeek;
}) {
  return input.bankHolidays.filter((holiday) =>
    isWorkingDayOnPattern(holiday.date, input.pattern)
  ).length;
}

export function countCompulsoryClosuresOnWorkingDays(input: {
  bankHolidays: BankHolidayDate[];
  companyClosures: CompanyClosureDate[];
  pattern: WorkingPatternWeek;
}) {
  const bankDates = new Set(input.bankHolidays.map((row) => row.date));
  return input.companyClosures.filter(
    (closure) =>
      closure.closureKind === "compulsory_leave" &&
      !bankDates.has(closure.date) &&
      isWorkingDayOnPattern(closure.date, input.pattern)
  ).length;
}

export function countPaidGiftClosuresOnWorkingDays(input: {
  companyClosures: CompanyClosureDate[];
  pattern: WorkingPatternWeek;
}) {
  return input.companyClosures.filter(
    (closure) =>
      closure.closureKind === "paid_gift" &&
      isWorkingDayOnPattern(closure.date, input.pattern)
  ).length;
}

export function buildEntitlementBreakdown(input: {
  grossPolicyDays: number;
  bankHolidays: BankHolidayDate[];
  companyClosures: CompanyClosureDate[];
  pattern?: WorkingPatternWeek;
  fteRatio: number;
  adjustmentDays: number;
  prorataStartDate?: string | null;
  holidayYear: number;
}): EntitlementBreakdown {
  const pattern = input.pattern ?? DEFAULT_MON_FRI_PATTERN;
  const bankHolidaysOnWorkingDays = countBankHolidaysOnWorkingDays({
    bankHolidays: input.bankHolidays,
    pattern,
  });
  const compulsoryClosuresOnWorkingDays = countCompulsoryClosuresOnWorkingDays({
    bankHolidays: input.bankHolidays,
    companyClosures: input.companyClosures,
    pattern,
  });
  const paidGiftClosuresOnWorkingDays = countPaidGiftClosuresOnWorkingDays({
    companyClosures: input.companyClosures,
    pattern,
  });

  const reservedPoolDays = roundLeaveDays(
    countReservedPoolDays({
      bankHolidays: input.bankHolidays,
      companyClosures: input.companyClosures,
      pattern,
    })
  );

  const nonBookable = countNonBookableClosureDays({
    bankHolidays: input.bankHolidays,
    companyClosures: input.companyClosures,
    pattern,
  });
  void nonBookable;

  const bookableEntitlementDays = proRataEntitlementDays({
    grossPolicyDays: input.grossPolicyDays,
    reservedPoolDays,
    fteRatio: input.fteRatio,
    adjustmentDays: input.adjustmentDays,
    prorataStartDate: input.prorataStartDate,
    holidayYear: input.holidayYear,
  });

  return {
    grossAllowanceDays: input.grossPolicyDays,
    bankHolidaysOnWorkingDays,
    compulsoryClosuresOnWorkingDays,
    paidGiftClosuresOnWorkingDays,
    reservedPoolDays,
    fteRatio: input.fteRatio,
    adjustmentDays: roundLeaveDays(input.adjustmentDays),
    prorataStartDate: input.prorataStartDate ?? null,
    bookableEntitlementDays,
  };
}

export function patternFromFlags(flags: {
  worksMon: boolean;
  worksTue: boolean;
  worksWed: boolean;
  worksThu: boolean;
  worksFri: boolean;
  worksSat: boolean;
  worksSun: boolean;
}): WorkingPatternWeek {
  return {
    worksMon: flags.worksMon,
    worksTue: flags.worksTue,
    worksWed: flags.worksWed,
    worksThu: flags.worksThu,
    worksFri: flags.worksFri,
    worksSat: flags.worksSat,
    worksSun: flags.worksSun,
  };
}
