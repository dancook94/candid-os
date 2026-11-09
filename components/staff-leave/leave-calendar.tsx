import { LeaveCalendarNav } from "@/components/staff-leave/leave-calendar-nav";
import type { CalendarDayCell } from "@/lib/staff-leave/calendar";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type LeaveCalendarProps = {
  basePath: string;
  year: number;
  month: number;
  heading: string;
  cells: CalendarDayCell[];
  prevHref: string;
  nextHref: string;
};

function cellClassNames(kinds: CalendarDayCell["kinds"]) {
  if (kinds.includes("approved_leave")) {
    return "bg-emerald-50 ring-1 ring-emerald-600/20";
  }
  if (kinds.includes("pending_leave")) {
    return "bg-amber-50 ring-1 ring-amber-600/20";
  }
  if (kinds.includes("bank_holiday")) {
    return "bg-sky-50 ring-1 ring-sky-600/15";
  }
  if (kinds.includes("compulsory_closure")) {
    return "bg-violet-50 ring-1 ring-violet-600/15";
  }
  if (kinds.includes("paid_gift")) {
    return "bg-teal-50 ring-1 ring-teal-600/15";
  }

  return "bg-card ring-1 ring-border/60";
}

export function LeaveCalendar({
  basePath,
  year,
  month,
  heading,
  cells,
  prevHref,
  nextHref,
}: LeaveCalendarProps) {
  return (
    <div className="space-y-4">
      <LeaveCalendarNav
        basePath={basePath}
        year={year}
        month={month}
        heading={heading}
        prevHref={prevHref}
        nextHref={nextHref}
      />

      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="py-1">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, index) => (
          <div
            key={`${cell.isoDate ?? "blank"}-${index}`}
            className={cn(
              "min-h-[4.5rem] rounded-lg p-1.5 text-left",
              cell.inMonth ? cellClassNames(cell.kinds) : "bg-transparent"
            )}
          >
            {cell.inMonth ? (
              <>
                <div className="text-xs font-semibold text-foreground">
                  {cell.dayOfMonth}
                </div>
                {cell.labels.slice(0, 2).map((label) => (
                  <p
                    key={label}
                    className="mt-0.5 line-clamp-2 text-[0.65rem] leading-tight text-muted-foreground"
                  >
                    {label}
                  </p>
                ))}
              </>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
