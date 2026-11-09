"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Select } from "@/components/ui/select";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  buildLeaveCalendarHref,
  LEAVE_CALENDAR_MONTH_NAMES,
  leaveCalendarYearOptions,
  londonYearMonthNow,
} from "@/lib/staff-leave/calendar";

type LeaveCalendarNavProps = {
  basePath: string;
  year: number;
  month: number;
  prevHref: string;
  nextHref: string;
  heading: string;
};

export function LeaveCalendarNav({
  basePath,
  year,
  month,
  prevHref,
  nextHref,
  heading,
}: LeaveCalendarNavProps) {
  const router = useRouter();
  const today = londonYearMonthNow();
  const todayHref = buildLeaveCalendarHref(basePath, today.year, today.month);
  const yearOptions = leaveCalendarYearOptions(today.year);

  function navigate(nextYear: number, nextMonth: number) {
    router.push(buildLeaveCalendarHref(basePath, nextYear, nextMonth));
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 className="text-lg font-semibold text-foreground">{heading}</h2>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <label className="sr-only" htmlFor={`leave-month-${basePath}`}>
            Month
          </label>
          <Select
            id={`leave-month-${basePath}`}
            className="min-w-[9.5rem]"
            value={String(month)}
            aria-label="Calendar month"
            onChange={(event) => navigate(year, Number(event.target.value))}
          >
            {LEAVE_CALENDAR_MONTH_NAMES.map((name, index) => (
              <option key={name} value={String(index + 1)}>
                {name}
              </option>
            ))}
          </Select>

          <label className="sr-only" htmlFor={`leave-year-${basePath}`}>
            Year
          </label>
          <Select
            id={`leave-year-${basePath}`}
            className="min-w-[6.5rem]"
            value={String(year)}
            aria-label="Calendar year"
            onChange={(event) => navigate(Number(event.target.value), month)}
          >
            {yearOptions.map((optionYear) => (
              <option key={optionYear} value={String(optionYear)}>
                {optionYear}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <Link
            href={prevHref}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border hover:bg-muted/60"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Link>
          <Link
            href={nextHref}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border hover:bg-muted/60"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link
            href={todayHref}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9")}
          >
            Today
          </Link>
        </div>
      </div>
    </div>
  );
}
