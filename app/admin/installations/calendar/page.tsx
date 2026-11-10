import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { InstallationCalendar } from "@/components/installations/installation-calendar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { buildPortalAppShellProps } from "@/lib/admin-shell-props";
import { calendarAnchor, calendarDates, calendarView, isCalendarBooking, visibleStaff, type CalendarBooking } from "@/lib/installations/calendar-view";
import { requireInstallationReader } from "@/lib/installations/page-access";
import { loadInstallationProjects, loadInstallerOptions } from "@/lib/installations/queries";
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

export default async function InstallationCalendarPage({
  searchParams,
}: {
  searchParams: Promise<CalendarParams>;
}) {
  const params = await searchParams;
  const view = calendarView(params.view);
  const today = londonTodayIso();
  const anchor = calendarAnchor(params.date, today);
  const dates = calendarDates(view, anchor);
  const selectedStaff = selectedStaffIds(params.staff);
  const supabase = await createClient();
  const profile = await requireInstallationReader(supabase, "/admin/installations/calendar");
  const shell = await buildPortalAppShellProps(supabase, profile);
  const admin = createAdminClient();
  const [projects, installers, unavailabilityResult] = await Promise.all([
    loadInstallationProjects(admin, supabase),
    loadInstallerOptions(admin),
    supabase.rpc("installation_team_unavailability", {
      p_start: dates[0],
      p_end: dates[dates.length - 1],
    }),
  ]);
  const unavailable = ((unavailabilityResult.data ?? []) as Unavailability[]).map((item) => ({
    profile_id: item.profile_id,
    profile_name: item.profile_name,
    kind: item.kind,
    start_date: item.start_date,
    end_date: item.end_date,
    day_portion: item.day_portion,
  }));
  const bookings: CalendarBooking[] = projects.flatMap((project) =>
    project.visits.filter(isCalendarBooking).map((visit) => ({
      visitId: visit.id,
      projectId: project.id,
      jobReference: project.jobReference,
      label: project.companyName || project.jobName || project.title,
      status: visit.status,
      scheduledStartAt: visit.scheduledStartAt || "",
      assigneeIds: visit.assignees.map((person) => person.profileId),
      assigneeNames: visit.assignees.map((person) => person.name),
    }))
  );
  const people = visibleStaff(installers, selectedStaff).map((installer) => ({
    id: installer.id,
    name: installer.name,
  }));
  const staff = Array.isArray(params.staff) ? params.staff.join(",") : params.staff || "";

  return (
    <AppShell {...shell}>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          eyebrow="Installation"
          title="Team calendar"
          description="Installation visits, approved holidays and recorded absences. One visit stays a single booking and is shown on every assigned installer."
          actions={
            <Link href="/admin/installations">
              <Button variant="outline">Board</Button>
            </Link>
          }
        />

        {unavailabilityResult.error ? (
          <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            Holiday and absence dates could not be loaded.
          </p>
        ) : null}

        <form className="mb-4 flex flex-wrap items-center gap-2">
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
          <p className="text-xs text-neutral-500">Leave everyone unticked to show all installers. Unassigned visits stay visible.</p>
        </form>

        <InstallationCalendar
          view={view}
          anchor={anchor}
          today={today}
          people={people}
          bookings={bookings}
          unavailable={unavailable}
          staff={staff}
        />
      </div>
    </AppShell>
  );
}
