import { addIsoDays, londonDateKey, mondayOf, monthBounds } from "@/lib/installations/labels";

export type CalendarView = "day" | "week" | "month";

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const CALENDAR_MONTHS = [
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

export type CalendarBooking = {
  visitId: string;
  projectId: string;
  jobReference: string | null;
  label: string;
  status: string;
  scheduledStartAt: string;
  assigneeIds: string[];
  assigneeNames: string[];
};

export function calendarView(value: string | undefined): CalendarView {
  if (value === "day" || value === "week" || value === "month") {
    return value;
  }

  return "day";
}

export function calendarAnchor(value: string | undefined, today: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today;
}

export function calendarDates(view: CalendarView, anchor: string) {
  if (view === "day") {
    return [anchor];
  }

  if (view === "week") {
    const start = mondayOf(anchor);
    return Array.from({ length: 7 }, (_, index) => addIsoDays(start, index));
  }

  const bounds = monthBounds(anchor);
  const start = mondayOf(bounds.start);
  const dates: string[] = [];

  for (
    let cursor = start;
    cursor <= addIsoDays(bounds.end, 6) && dates.length < 42;
    cursor = addIsoDays(cursor, 1)
  ) {
    dates.push(cursor);
    if (cursor >= bounds.end && new Date(`${cursor}T00:00:00Z`).getUTCDay() === 0) {
      break;
    }
  }

  return dates;
}

function clampedDate(year: number, month: number, day: number) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const clamped = Math.min(day, last);
  return `${year}-${String(month).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}

export function addCalendarMonths(isoDate: string, months: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  return clampedDate(target.getUTCFullYear(), target.getUTCMonth() + 1, day);
}

export function stepCalendar(view: CalendarView, anchor: string, direction: -1 | 1) {
  if (view === "month") {
    return addCalendarMonths(anchor, direction);
  }

  if (view === "week") {
    return addIsoDays(anchor, direction * 7);
  }

  return addIsoDays(anchor, direction);
}

export function setCalendarMonth(anchor: string, month: number) {
  const [year, , day] = anchor.split("-").map(Number);
  return clampedDate(year, month, day);
}

export function setCalendarYear(anchor: string, year: number) {
  const [, month, day] = anchor.split("-").map(Number);
  return clampedDate(year, month, day);
}

export function calendarYearOptions(anchor: string, today: string) {
  const anchorYear = Number(anchor.slice(0, 4));
  const todayYear = Number(today.slice(0, 4));
  const start = Math.min(anchorYear, todayYear) - 1;
  const end = Math.max(anchorYear, todayYear) + 2;
  const years: number[] = [];

  for (let year = start; year <= end; year += 1) {
    years.push(year);
  }

  return years;
}

export function calendarHeading(anchor: string) {
  const [year, month, day] = anchor.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function isCalendarBooking(visit: { scheduledStartAt: string | null; status: string }) {
  return Boolean(visit.scheduledStartAt) && visit.status !== "cancelled";
}

export function bookingsOnDate(bookings: readonly CalendarBooking[], isoDate: string) {
  return bookings.filter((booking) => londonDateKey(booking.scheduledStartAt) === isoDate);
}

export function bookingsForInstaller(
  bookings: readonly CalendarBooking[],
  profileId: string,
  isoDate: string
) {
  return bookingsOnDate(bookings, isoDate).filter((booking) => booking.assigneeIds.includes(profileId));
}

export function unassignedBookings(bookings: readonly CalendarBooking[], isoDate: string) {
  return bookingsOnDate(bookings, isoDate).filter((booking) => booking.assigneeIds.length === 0);
}

export function visibleStaff<T extends { id: string }>(people: readonly T[], selected: ReadonlySet<string>) {
  if (selected.size === 0) {
    return [...people];
  }

  return people.filter((person) => selected.has(person.id));
}
