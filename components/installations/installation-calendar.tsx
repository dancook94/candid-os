"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  CALENDAR_MONTHS,
  WEEKDAY_LABELS,
  bookingsForInstaller,
  bookingsOnDate,
  calendarDates,
  calendarHeading,
  calendarYearOptions,
  setCalendarMonth,
  setCalendarYear,
  stepCalendar,
  unassignedBookings,
  type CalendarBooking,
  type CalendarView,
} from "@/lib/installations/calendar-view";
import { VISIT_STATUS_LABELS, formatLondonTime } from "@/lib/installations/labels";
import { cn } from "@/lib/utils";

type Person = { id: string; name: string };

type Unavailability = {
  profile_id: string;
  profile_name: string;
  kind: string;
  start_date: string;
  end_date: string;
  day_portion: string;
};

export function InstallationCalendar({
  view,
  anchor,
  today,
  people,
  bookings,
  unavailable,
  staff,
}: {
  view: CalendarView;
  anchor: string;
  today: string;
  people: Person[];
  bookings: CalendarBooking[];
  unavailable: Unavailability[];
  staff: string;
}) {
  const router = useRouter();
  const dates = calendarDates(view, anchor);
  const years = calendarYearOptions(anchor, today);
  const month = Number(anchor.slice(5, 7));
  const year = Number(anchor.slice(0, 4));

  function href(next: { view?: CalendarView; date?: string }) {
    const query = new URLSearchParams();
    query.set("view", next.view || view);
    query.set("date", next.date || anchor);
    if (staff) {
      query.set("staff", staff);
    }
    return `/admin/installations/calendar?${query.toString()}`;
  }

  function openDate(date: string, nextView = view) {
    router.push(href({ view: nextView, date }));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold text-neutral-950">{calendarHeading(anchor)}</h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Select
              aria-label="Calendar month"
              value={String(month)}
              onChange={(event) => openDate(setCalendarMonth(anchor, Number(event.target.value)))}
            >
              {CALENDAR_MONTHS.map((name, index) => (
                <option key={name} value={String(index + 1)}>
                  {name}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Calendar year"
              value={String(year)}
              onChange={(event) => openDate(setCalendarYear(anchor, Number(event.target.value)))}
            >
              {years.map((option) => (
                <option key={option} value={String(option)}>
                  {option}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <Link
              href={href({ date: stepCalendar(view, anchor, -1) })}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50"
              aria-label={view === "month" ? "Previous month" : view === "week" ? "Previous week" : "Previous day"}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              href={href({ date: stepCalendar(view, anchor, 1) })}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50"
              aria-label={view === "month" ? "Next month" : view === "week" ? "Next week" : "Next day"}
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link href={href({ date: today })} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9")}>
              Today
            </Link>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["day", "week", "month"] as const).map((item) => (
          <Link key={item} href={href({ view: item })}>
            <Button variant={view === item ? "default" : "outline"} className="capitalize">
              {item}
            </Button>
          </Link>
        ))}
      </div>

      <ul className="flex flex-wrap gap-3 text-xs text-neutral-600">
        <li className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-sky-300 bg-sky-50" />
          Installation
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-emerald-300 bg-emerald-50" />
          Holiday
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-amber-300 bg-amber-50" />
          Absence
        </li>
      </ul>

      {view === "month" ? (
        <MonthGrid dates={dates} anchor={anchor} today={today} bookings={bookings} unavailable={unavailable} people={people} />
      ) : (
        <StaffGrid dates={dates} today={today} people={people} bookings={bookings} unavailable={unavailable} />
      )}
    </div>
  );
}

function absenceLabel(item: Unavailability) {
  const name = item.kind === "leave" ? "Holiday" : "Absence";
  if (item.day_portion === "am") {
    return `${name} AM`;
  }
  if (item.day_portion === "pm") {
    return `${name} PM`;
  }
  return name;
}

function covers(item: Unavailability, isoDate: string) {
  return item.start_date <= isoDate && item.end_date >= isoDate;
}

function BookingLink({ booking, compact = false }: { booking: CalendarBooking; compact?: boolean }) {
  const names = booking.assigneeNames.filter(Boolean).join(", ");
  const status = VISIT_STATUS_LABELS[booking.status as keyof typeof VISIT_STATUS_LABELS] || booking.status;

  return (
    <Link
      href={`/admin/installations/${booking.projectId}`}
      className="mt-1 block rounded-md border border-sky-200 bg-sky-50 px-1.5 py-1 text-xs text-sky-950 hover:border-sky-400"
    >
      <span className="block font-semibold">{booking.jobReference || "No job"}</span>
      <span className="block truncate">{booking.label}</span>
      <span className="block text-[11px]">
        {formatLondonTime(booking.scheduledStartAt)} · {status}
      </span>
      {compact ? null : <span className="block truncate text-[11px]">{names || "Unassigned"}</span>}
    </Link>
  );
}

function AwayChip({ item }: { item: Unavailability }) {
  const holiday = item.kind === "leave";
  return (
    <p
      className={cn(
        "mt-1 rounded px-1.5 py-1 text-xs",
        holiday
          ? "border border-emerald-200 bg-emerald-50 text-emerald-950"
          : "border border-amber-200 bg-amber-50 text-amber-950"
      )}
    >
      {absenceLabel(item)}
    </p>
  );
}

function StaffGrid({
  dates,
  today,
  people,
  bookings,
  unavailable,
}: {
  dates: string[];
  today: string;
  people: Person[];
  bookings: CalendarBooking[];
  unavailable: Unavailability[];
}) {
  const unassignedDates = dates.filter((date) => unassignedBookings(bookings, date).length > 0);

  return (
    <div className="space-y-3">
      {unassignedDates.length > 0 ? (
        <section className="rounded-xl border border-neutral-200 bg-white p-3">
          <h3 className="mb-2 text-sm font-semibold text-neutral-950">Unassigned</h3>
          <DayColumns
            dates={dates}
            today={today}
            bookingsFor={(date) => unassignedBookings(bookings, date)}
            awayFor={() => []}
          />
        </section>
      ) : null}
      {people.map((person) => (
        <section key={person.id} className="rounded-xl border border-neutral-200 bg-white p-3">
          <h3 className="mb-2 text-sm font-semibold text-neutral-950">{person.name}</h3>
          <DayColumns
            dates={dates}
            today={today}
            bookingsFor={(date) => bookingsForInstaller(bookings, person.id, date)}
            awayFor={(date) => unavailable.filter((item) => item.profile_id === person.id && covers(item, date))}
          />
        </section>
      ))}
    </div>
  );
}

function DayColumns({
  dates,
  today,
  bookingsFor,
  awayFor,
}: {
  dates: string[];
  today: string;
  bookingsFor: (date: string) => CalendarBooking[];
  awayFor: (date: string) => Unavailability[];
}) {
  return (
    <div className={dates.length > 1 ? "overflow-x-auto" : ""}>
      {dates.length > 1 ? (
        <div className="grid min-w-[42rem] grid-cols-7 gap-2 text-center text-xs font-medium text-neutral-500">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="py-1">
              {label}
            </div>
          ))}
        </div>
      ) : null}
      <div className={dates.length > 1 ? "grid min-w-[42rem] grid-cols-7 gap-2" : "grid gap-2"}>
        {dates.map((date) => (
          <div
            key={date}
            className={cn(
              "min-h-24 rounded-lg bg-neutral-50 p-2",
              date === today && "ring-2 ring-sky-600"
            )}
          >
            <p className={cn("text-xs font-medium text-neutral-500", date === today && "text-sky-800")}>
              {dates.length === 1
                ? new Intl.DateTimeFormat("en-GB", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    timeZone: "UTC",
                  }).format(new Date(`${date}T00:00:00Z`))
                : date.slice(8)}
            </p>
            {awayFor(date).map((item) => (
              <AwayChip key={`${item.kind}-${item.profile_id}-${item.start_date}-${item.day_portion}`} item={item} />
            ))}
            {bookingsFor(date).map((booking) => (
              <BookingLink key={booking.visitId} booking={booking} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthGrid({
  dates,
  anchor,
  today,
  bookings,
  unavailable,
  people,
}: {
  dates: string[];
  anchor: string;
  today: string;
  bookings: CalendarBooking[];
  unavailable: Unavailability[];
  people: Person[];
}) {
  const month = anchor.slice(0, 7);
  const personIds = new Set(people.map((person) => person.id));

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[42rem] grid-cols-7 gap-1 text-center text-xs font-medium text-neutral-500">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="py-1">
            {label}
          </div>
        ))}
      </div>
      <div className="grid min-w-[42rem] grid-cols-7 gap-1">
        {dates.map((date) => {
          const inMonth = date.startsWith(month);
          const placed = bookingsOnDate(bookings, date);
          const away = unavailable.filter((item) => personIds.has(item.profile_id) && covers(item, date));
          return (
            <div
              key={date}
              className={cn(
                "min-h-28 rounded-lg border p-2",
                inMonth ? "border-neutral-200 bg-white" : "border-transparent bg-neutral-50",
                date === today && "ring-2 ring-sky-600"
              )}
            >
              <p className={cn("text-xs font-medium text-neutral-500", date === today && "text-sky-800")}>{date.slice(8)}</p>
              {away.some((item) => item.kind === "leave") ? (
                <p className="mt-1 text-[11px] text-emerald-800">
                  {away.filter((item) => item.kind === "leave").length} holiday
                </p>
              ) : null}
              {away.some((item) => item.kind !== "leave") ? (
                <p className="mt-1 text-[11px] text-amber-800">
                  {away.filter((item) => item.kind !== "leave").length} absence
                </p>
              ) : null}
              {placed.map((booking) => (
                <BookingLink key={booking.visitId} booking={booking} compact />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
