import type { BankHolidayDate, CompanyClosureDate, WorkingPatternWeek } from "@/lib/staff-leave/types";
import { roundLeaveDays } from "@/lib/staff-leave/balance";
import { isoDatesBetweenInclusive, isWorkingDayOnPattern } from "@/lib/staff-leave/working-days";

export type PatternSegment = {
  effectiveFrom: string;
  pattern: WorkingPatternWeek;
  fteRatio: number;
};

export type SegmentedEntitlementInput = {
  holidayYear: number;
  grossPolicyDays: number;
  bankHolidays: BankHolidayDate[];
  companyClosures: CompanyClosureDate[];
  segments: PatternSegment[];
  /** Europe/London calendar date for display (excludes not-yet-effective segments). */
  asOf: string;
  adjustmentDays?: number;
  prorataStartDate?: string | null;
};

function yearBounds(holidayYear: number) {
  return {
    start: `${holidayYear}-01-01`,
    end: `${holidayYear}-12-31`,
  };
}

function daysInclusive(startIso: string, endIso: string) {
  return isoDatesBetweenInclusive(startIso, endIso).length;
}

function segmentEnd(
  segments: PatternSegment[],
  index: number,
  holidayYear: number,
  asOf: string
): string {
  const yearEnd = yearBounds(holidayYear).end;
  const next = segments[index + 1];
  if (next) {
    if (next.effectiveFrom > asOf) {
      return yearEnd;
    }
    const d = new Date(next.effectiveFrom);
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return yearEnd;
}

/** Reserved pool for one segment using that segment's working pattern only. */
export function reservedPoolForSegment(input: {
  segmentStart: string;
  segmentEnd: string;
  pattern: WorkingPatternWeek;
  bankHolidays: BankHolidayDate[];
  companyClosures: CompanyClosureDate[];
}) {
  const bank = input.bankHolidays.filter(
    (h) => h.date >= input.segmentStart && h.date <= input.segmentEnd
  );
  const compulsory = input.companyClosures.filter(
    (c) =>
      c.closureKind === "compulsory_leave" &&
      c.date >= input.segmentStart &&
      c.date <= input.segmentEnd
  );

  let total = 0;
  const bankDates = new Set(bank.map((b) => b.date));

  for (const holiday of bank) {
    if (isWorkingDayOnPattern(holiday.date, input.pattern)) {
      total += 1;
    }
  }

  for (const closure of compulsory) {
    if (bankDates.has(closure.date)) {
      continue;
    }
    if (isWorkingDayOnPattern(closure.date, input.pattern)) {
      total += 1;
    }
  }

  return total;
}

/**
 * Bookable annual entitlement when working patterns may change mid-year.
 * - Skips segments with effectiveFrom > asOf (future patterns do not affect today's balance).
 * - While a later pattern is still future, the active segment runs to year-end (no premature pro-rata).
 * - After a mid-year change has taken effect, splits gross by calendar days per segment.
 * - Reserved closures/bank holidays use the segment pattern only (not later effective-dated patterns).
 */
export function segmentedBookableEntitlement(input: SegmentedEntitlementInput) {
  const { start: yearStart, end: yearEnd } = yearBounds(input.holidayYear);
  const yearDays = daysInclusive(yearStart, yearEnd);
  const ordered = [...input.segments].sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom)
  );

  let bookable = 0;
  let reservedTotal = 0;

  for (let i = 0; i < ordered.length; i += 1) {
    const segment = ordered[i];
    if (segment.effectiveFrom > input.asOf) {
      continue;
    }

    const segStart =
      segment.effectiveFrom > yearStart ? segment.effectiveFrom : yearStart;
    const rawEnd = segmentEnd(ordered, i, input.holidayYear, input.asOf);
    const segEnd = rawEnd > yearEnd ? yearEnd : rawEnd;
    if (segEnd < segStart) {
      continue;
    }

    const segDays = daysInclusive(segStart, segEnd);
    const grossShare = (input.grossPolicyDays * segDays) / yearDays;
    const reserved = reservedPoolForSegment({
      segmentStart: segStart,
      segmentEnd: segEnd,
      pattern: segment.pattern,
      bankHolidays: input.bankHolidays,
      companyClosures: input.companyClosures,
    });
    reservedTotal += reserved;
    bookable += Math.max(0, grossShare - reserved) * segment.fteRatio;
  }

  bookable += input.adjustmentDays ?? 0;

  if (input.prorataStartDate) {
    const startYear = Number(input.prorataStartDate.slice(0, 4));
    if (startYear === input.holidayYear) {
      const fraction =
        daysInclusive(input.prorataStartDate, yearEnd) / yearDays;
      bookable *= Math.min(1, Math.max(0, fraction));
    }
  }

  return {
    bookableEntitlementDays: roundLeaveDays(bookable),
    reservedPoolDays: roundLeaveDays(reservedTotal),
  };
}
