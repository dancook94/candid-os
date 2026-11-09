import { formatIsoDateLocal, parseIsoDateLocal } from "@/lib/staff-leave/working-days";

export const LEAVE_CALENDAR_TIME_ZONE = "Europe/London";

export const LEAVE_CALENDAR_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function londonTodayIso(reference = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LEAVE_CALENDAR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(reference);
}

export function londonYearMonthNow(reference = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LEAVE_CALENDAR_TIME_ZONE,
    year: "numeric",
    month: "numeric",
  }).formatToParts(reference);

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return {
      year: reference.getFullYear(),
      month: reference.getMonth() + 1,
    };
  }

  return { year, month };
}

export function leaveCalendarYearOptions(anchorYear = londonYearMonthNow().year) {
  const years: number[] = [];
  for (let year = anchorYear - 2; year <= anchorYear + 5; year += 1) {
    years.push(year);
  }
  return years;
}

export function buildLeaveCalendarHref(basePath: string, year: number, month: number) {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
  });
  return `${basePath}?${params.toString()}`;
}

export type CalendarDayKind =
  | "empty"
  | "day"
  | "bank_holiday"
  | "compulsory_closure"
  | "paid_gift"
  | "approved_leave"
  | "pending_leave";

export type CalendarDayCell = {
  isoDate: string | null;
  dayOfMonth: number | null;
  inMonth: boolean;
  kinds: CalendarDayKind[];
  labels: string[];
};

export function parseYearMonth(searchParams: {
  year?: string;
  month?: string;
}) {
  const now = londonYearMonthNow();
  const year = searchParams.year ? Number(searchParams.year) : now.year;
  const month = searchParams.month ? Number(searchParams.month) : now.month;

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return { year: now.year, month: now.month };
  }

  return { year, month };
}

export function monthNavigation(year: number, month: number) {
  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return { prev, next };
}

export function buildMonthGrid(
  year: number,
  month: number,
  markers: Map<string, { kinds: CalendarDayKind[]; labels: string[] }>
): CalendarDayCell[] {
  const firstOfMonth = new Date(year, month - 1, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells: CalendarDayCell[] = [];

  for (let i = 0; i < startOffset; i += 1) {
    cells.push({
      isoDate: null,
      dayOfMonth: null,
      inMonth: false,
      kinds: ["empty"],
      labels: [],
    });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const isoDate = formatIsoDateLocal(new Date(year, month - 1, day));
    const marker = markers.get(isoDate);
    cells.push({
      isoDate,
      dayOfMonth: day,
      inMonth: true,
      kinds: marker?.kinds ?? ["day"],
      labels: marker?.labels ?? [],
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({
      isoDate: null,
      dayOfMonth: null,
      inMonth: false,
      kinds: ["empty"],
      labels: [],
    });
  }

  return cells;
}

export function dateInLeaveRange(isoDate: string, start: string, end: string) {
  const d = parseIsoDateLocal(isoDate).getTime();
  return d >= parseIsoDateLocal(start).getTime() && d <= parseIsoDateLocal(end).getTime();
}

export function formatMonthHeading(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: LEAVE_CALENDAR_TIME_ZONE,
  });
}
