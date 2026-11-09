import type {
  BankHolidayDate,
  CompanyClosureDate,
  LeaveDayPortion,
  WorkingPatternWeek,
} from "@/lib/staff-leave/types";

const MS_PER_DAY = 86_400_000;

export function parseIsoDateLocal(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatIsoDateLocal(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isoDatesBetweenInclusive(startIso: string, endIso: string) {
  const start = parseIsoDateLocal(startIso);
  const end = parseIsoDateLocal(endIso);

  if (end < start) {
    return [];
  }

  const dates: string[] = [];
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += MS_PER_DAY) {
    dates.push(formatIsoDateLocal(new Date(cursor)));
  }

  return dates;
}

export function weekdayIndex(isoDate: string) {
  return parseIsoDateLocal(isoDate).getDay();
}

export function isWorkingDayOnPattern(isoDate: string, pattern: WorkingPatternWeek) {
  switch (weekdayIndex(isoDate)) {
    case 0:
      return pattern.worksSun;
    case 1:
      return pattern.worksMon;
    case 2:
      return pattern.worksTue;
    case 3:
      return pattern.worksWed;
    case 4:
      return pattern.worksThu;
    case 5:
      return pattern.worksFri;
    case 6:
      return pattern.worksSat;
    default:
      return false;
  }
}

export function bankHolidaySet(holidays: BankHolidayDate[]) {
  return new Set(holidays.map((item) => item.date));
}

export function closureSet(closures: CompanyClosureDate[]) {
  return new Set(closures.map((item) => item.date));
}

export function isReservedDay(
  isoDate: string,
  bankHolidays: Set<string>,
  companyClosures: Set<string>
) {
  return bankHolidays.has(isoDate) || companyClosures.has(isoDate);
}

export function countReservedPoolDays(input: {
  bankHolidays: BankHolidayDate[];
  companyClosures: CompanyClosureDate[];
  pattern: WorkingPatternWeek;
}) {
  const bank = bankHolidaySet(input.bankHolidays);
  const compulsory = input.companyClosures.filter((c) => c.closureKind === "compulsory_leave");
  let total = 0;

  for (const holiday of input.bankHolidays) {
    if (isWorkingDayOnPattern(holiday.date, input.pattern)) {
      total += 1;
    }
  }

  for (const closure of compulsory) {
    if (bank.has(closure.date)) {
      continue;
    }

    if (isWorkingDayOnPattern(closure.date, input.pattern)) {
      total += 1;
    }
  }

  return total;
}

export function countNonBookableClosureDays(input: {
  companyClosures: CompanyClosureDate[];
  pattern: WorkingPatternWeek;
  bankHolidays: BankHolidayDate[];
}) {
  const bank = bankHolidaySet(input.bankHolidays);
  let total = 0;

  for (const closure of input.companyClosures) {
    if (bank.has(closure.date)) {
      continue;
    }

    if (isWorkingDayOnPattern(closure.date, input.pattern)) {
      total += 1;
    }
  }

  return total;
}

export function countLeaveDaysInRange(input: {
  startDate: string;
  endDate: string;
  dayPortion: LeaveDayPortion;
  pattern: WorkingPatternWeek;
  bankHolidays: BankHolidayDate[];
  companyClosures: CompanyClosureDate[];
}) {
  if (input.dayPortion !== "full" && input.startDate !== input.endDate) {
    throw new Error("Half-day leave must be a single calendar day.");
  }

  const bank = bankHolidaySet(input.bankHolidays);
  const closures = closureSet(input.companyClosures);
  const dates = isoDatesBetweenInclusive(input.startDate, input.endDate);
  let total = 0;

  for (const isoDate of dates) {
    if (!isWorkingDayOnPattern(isoDate, input.pattern)) {
      continue;
    }

    if (isReservedDay(isoDate, bank, closures)) {
      continue;
    }

    if (input.dayPortion === "full") {
      total += 1;
    } else {
      total += 0.5;
    }
  }

  return total;
}

export function holidayYearForStartDate(startDate: string) {
  return parseIsoDateLocal(startDate).getFullYear();
}

export function rangesOverlap(
  leftStart: string,
  leftEnd: string,
  rightStart: string,
  rightEnd: string
) {
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

export const DEFAULT_MON_FRI_PATTERN: WorkingPatternWeek = {
  worksMon: true,
  worksTue: true,
  worksWed: true,
  worksThu: true,
  worksFri: true,
  worksSat: false,
  worksSun: false,
};
