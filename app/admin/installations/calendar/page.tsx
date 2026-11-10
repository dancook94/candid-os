import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { buildPortalAppShellProps } from "@/lib/admin-shell-props";
import { addIsoDays, formatLondonWhen, londonDateKey, mondayOf, monthBounds } from "@/lib/installations/labels";
import { requireInstallationReader } from "@/lib/installations/page-access";
import {
  loadInstallationProjects,
  loadInstallerOptions,
  type InstallationVisitRecord,
} from "@/lib/installations/queries";
import { londonTodayIso } from "@/lib/staff-leave/calendar";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type CalendarParams = {
  view?: string;
  date?: string;
  staff?: string | string[];
};

function selectedStaffIds(value: string | string[] | undefined) {
  const values = Array.isArray(value) ? value : (value || "").split(",");
  return new Set(values.map((item) => item.trim()).filter(Boolean));
}

type Unavailability = {
  profile_id: string;
  profile_name: string;
  kind: string;
  start_date: string;
  end_date: string;
  day_portion: string;
};

function viewOf(value: string | undefined): "day" | "week" | "month" {
  if (value === "week" || value === "month") {
    return value;
  }

  return "day";
}

function datesFor(view: "day" | "week" | "month", anchor: string) {
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
  for (let cursor = start; cursor <= addIsoDays(bounds.end, 6) && dates.length < 42; cursor = addIsoDays(cursor, 1)) {
    dates.push(cursor);
    if (cursor >= bounds.end && new Date(`${cursor}T00:00:00Z`).getUTCDay() === 0) {
      break;
    }
  }
  return dates;
}

function covers(item: Unavailability, isoDate: string) {
  return item.start_date <= isoDate && item.end_date >= isoDate;
}

export default async function InstallationCalendarPage({
  searchParams,
}: {
  searchParams: Promise<CalendarParams>;
}) {
  const params = await searchParams;
  const view = viewOf(params.view);
  const anchor = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : londonTodayIso();
  const dates = datesFor(view, anchor);
  const rangeStart = dates[0];
  const rangeEnd = dates[dates.length - 1];
  const selectedStaff = selectedStaffIds(params.staff);
  const supabase = await createClient();
  const profile = await requireInstallationReader(supabase, "/admin/installations/calendar");
  const shell = await buildPortalAppShellProps(supabase, profile);
  const admin = createAdminClient();
  const [projects, installers, unavailabilityResult] = await Promise.all([
    loadInstallationProjects(admin, supabase),
    loadInstallerOptions(admin),
    supabase.rpc("installation_team_unavailability", {
      p_start: rangeStart,
      p_end: rangeEnd,
    }),
  ]);
  const unavailable = (unavailabilityResult.data ?? []) as Unavailability[];
  const visits = projects.flatMap((project) =>
    project.visits
      .filter((visit) => visit.scheduledStartAt && !["cancelled"].includes(visit.status))
      .map((visit) => ({ project, visit }))
  );
  const people = installers.filter((installer) => selectedStaff.size === 0 || selectedStaff.has(installer.id));

  function href(next: { view?: string; date?: string; staff?: string }) {
    const query = new URLSearchParams();
    query.set("view", next.view || view);
    query.set("date", next.date || anchor);
    const currentStaff = Array.isArray(params.staff) ? params.staff.join(",") : params.staff || "";
    const staff = next.staff === undefined ? currentStaff : next.staff;
    if (staff) {
      query.set("staff", staff);
    }
    return `/admin/installations/calendar?${query.toString()}`;
  }

  return (
    <AppShell {...shell}>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          eyebrow="Installation"
          title="Team calendar"
          description="Installation visits, approved holidays and recorded absences. One visit stays a single booking and is shown for every assigned installer."
          actions={
            <Link href="/admin/installations">
              <Button variant="outline">Board</Button>
            </Link>
          }
        />

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(["day", "week", "month"] as const).map((item) => (
            <Link key={item} href={href({ view: item })}>
              <Button variant={view === item ? "default" : "outline"} className="capitalize">
                {item}
              </Button>
            </Link>
          ))}
          <Link href={href({ date: addIsoDays(anchor, view === "month" ? -30 : view === "week" ? -7 : -1) })}>
            <Button variant="outline">Previous</Button>
          </Link>
          <Link href={href({ date: londonTodayIso() })}>
            <Button variant="outline">Today</Button>
          </Link>
          <Link href={href({ date: addIsoDays(anchor, view === "month" ? 30 : view === "week" ? 7 : 1) })}>
            <Button variant="outline">Next</Button>
          </Link>
        </div>

        {unavailabilityResult.error ? (
          <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            Holiday and absence dates are unavailable until the Phase 3 database migration is applied on Test.
          </p>
        ) : null}

        <form className="mb-4 flex flex-wrap gap-2">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="date" value={anchor} />
          {installers.map((installer) => (
            <label key={installer.id} className="inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm">
              <input type="checkbox" name="staff" value={installer.id} defaultChecked={selectedStaff.has(installer.id)} />
              {installer.name}
            </label>
          ))}
          <Button type="submit" variant="outline">
            Filter staff
          </Button>
        </form>

        {view === "month" ? (
          <MonthGrid dates={dates} anchor={anchor} visits={visits} unavailable={unavailable} people={people} />
        ) : (
          <StaffGrid dates={dates} people={people} visits={visits} unavailable={unavailable} />
        )}
      </div>
    </AppShell>
  );
}

function visitForPerson(visit: InstallationVisitRecord, profileId: string) {
  return visit.assignees.some((person) => person.profileId === profileId);
}

function StaffGrid({
  dates,
  people,
  visits,
  unavailable,
}: {
  dates: string[];
  people: { id: string; name: string }[];
  visits: { project: { id: string; title: string; jobReference: string | null }; visit: InstallationVisitRecord }[];
  unavailable: Unavailability[];
}) {
  return (
    <div className="space-y-3">
      {people.map((person) => (
        <section key={person.id} className="rounded-xl border border-neutral-200 bg-white p-3">
          <h2 className="mb-2 text-sm font-semibold text-neutral-950">{person.name}</h2>
          <div className={`grid gap-2 ${dates.length > 1 ? "sm:grid-cols-7" : ""}`}>
            {dates.map((date) => (
              <div key={date} className="min-h-24 rounded-lg bg-neutral-50 p-2">
                <p className="text-xs font-medium text-neutral-500">{date.slice(8)}</p>
                {unavailable.filter((item) => item.profile_id === person.id && covers(item, date)).map((item) => (
                  <p key={`${item.kind}-${item.start_date}-${date}`} className="mt-1 rounded bg-neutral-200 px-1.5 py-1 text-xs text-neutral-800">
                    {item.kind === "leave" ? "Holiday" : "Absence"}
                    {item.day_portion === "am" ? " AM" : item.day_portion === "pm" ? " PM" : ""}
                  </p>
                ))}
                {visits
                  .filter(({ visit }) => visitForPerson(visit, person.id) && londonDateKey(visit.scheduledStartAt) === date)
                  .map(({ project, visit }) => (
                    <Link
                      key={visit.id}
                      href={`/admin/installations/${project.id}`}
                      className="mt-1 block rounded bg-neutral-950 px-1.5 py-1 text-xs text-white"
                    >
                      {project.jobReference || project.title}
                      <span className="block text-[10px] text-neutral-200">{formatLondonWhen(visit.scheduledStartAt)}</span>
                    </Link>
                  ))}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function MonthGrid({
  dates,
  anchor,
  visits,
  unavailable,
  people,
}: {
  dates: string[];
  anchor: string;
  visits: { project: { id: string; title: string; jobReference: string | null }; visit: InstallationVisitRecord }[];
  unavailable: Unavailability[];
  people: { id: string; name: string }[];
}) {
  const month = anchor.slice(0, 7);
  const personIds = new Set(people.map((person) => person.id));

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-7">
      {dates.map((date) => {
        const inMonth = date.startsWith(month);
        const dayVisits = visits.filter(({ visit }) => londonDateKey(visit.scheduledStartAt) === date);
        const away = unavailable.filter(
          (item) => personIds.has(item.profile_id) && covers(item, date)
        );
        return (
          <div key={date} className={`min-h-28 rounded-lg border p-2 ${inMonth ? "border-neutral-200 bg-white" : "border-transparent bg-neutral-50"}`}>
            <p className="text-xs font-medium text-neutral-500">{date.slice(8)}</p>
            {away.length > 0 ? (
              <p className="mt-1 text-[11px] text-neutral-600">{away.length} unavailable</p>
            ) : null}
            {dayVisits.map(({ project, visit }) => (
              <Link key={visit.id} href={`/admin/installations/${project.id}`} className="mt-1 block truncate text-xs font-medium text-neutral-950 underline">
                {project.jobReference || visit.title}
              </Link>
            ))}
          </div>
        );
      })}
    </div>
  );
}
