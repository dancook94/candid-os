import type { CalendarDayKind } from "@/lib/staff-leave/calendar";
import { dateInLeaveRange } from "@/lib/staff-leave/calendar";
import type { BankHolidayRow, CompanyClosureRow } from "@/lib/staff-leave/queries";

type LeaveSpan = {
  start_date: string;
  end_date: string;
  status: string;
  label: string;
};

export function buildCalendarMarkers(input: {
  bankHolidays: BankHolidayRow[];
  closures: CompanyClosureRow[];
  leaveSpans: LeaveSpan[];
  monthDates: string[];
}) {
  const markers = new Map<string, { kinds: CalendarDayKind[]; labels: string[] }>();

  for (const isoDate of input.monthDates) {
    markers.set(isoDate, { kinds: ["day"], labels: [] });
  }

  for (const bankHoliday of input.bankHolidays) {
    if (!markers.has(bankHoliday.holiday_date)) continue;
    const cell = markers.get(bankHoliday.holiday_date)!;
    cell.kinds.push("bank_holiday");
    cell.labels.push(bankHoliday.name);
  }

  for (const closure of input.closures) {
    if (!markers.has(closure.closure_date)) continue;
    const cell = markers.get(closure.closure_date)!;
    if (closure.closure_kind === "compulsory_leave") {
      cell.kinds.push("compulsory_closure");
    } else {
      cell.kinds.push("paid_gift");
    }
    cell.labels.push(closure.name);
  }

  for (const span of input.leaveSpans) {
    for (const isoDate of input.monthDates) {
      if (!dateInLeaveRange(isoDate, span.start_date, span.end_date)) continue;
      const cell = markers.get(isoDate)!;
      if (span.status === "approved") {
        cell.kinds.push("approved_leave");
      } else if (span.status === "pending") {
        cell.kinds.push("pending_leave");
      }
      if (!cell.labels.includes(span.label)) {
        cell.labels.push(span.label);
      }
    }
  }

  return markers;
}

export function monthDateRange(year: number, month: number) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const dates: string[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    dates.push(iso);
  }
  return dates;
}
