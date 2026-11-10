import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { buildPortalAppShellProps } from "@/lib/admin-shell-props";
import { PROJECT_STATUS_LABELS, VISIT_STATUS_LABELS, formatLondonWhen, londonDateKey } from "@/lib/installations/labels";
import { requireInstallationReader } from "@/lib/installations/page-access";
import {
  loadInstallationCompanies,
  loadInstallationProjects,
  loadInstallerOptions,
  nextVisit,
  siteSummary,
  type InstallationProjectRecord,
} from "@/lib/installations/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = {
  status?: string;
  date?: string;
  installer?: string;
  customer?: string;
};

function matches(project: InstallationProjectRecord, filters: SearchParams) {
  if (filters.status && project.status !== filters.status) {
    return false;
  }

  if (filters.customer && project.companyId !== filters.customer) {
    return false;
  }

  const visit = nextVisit(project);

  if (filters.date) {
    const onDate = project.visits.some((item) => londonDateKey(item.scheduledStartAt) === filters.date);
    if (!onDate) {
      return false;
    }
  }

  if (filters.installer) {
    const assigned = project.visits.some((item) =>
      item.assignees.some((person) => person.profileId === filters.installer)
    );
    if (!assigned) {
      return false;
    }
  }

  return Boolean(visit || project);
}

export default async function InstallationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const filters = await searchParams;
  const supabase = await createClient();
  const profile = await requireInstallationReader(supabase, "/admin/installations");
  const shell = await buildPortalAppShellProps(supabase, profile);
  const admin = createAdminClient();
  const [projects, companies, installers] = await Promise.all([
    loadInstallationProjects(admin, supabase),
    loadInstallationCompanies(admin),
    loadInstallerOptions(admin),
  ]);
  const visible = projects.filter((project) => matches(project, filters));

  return (
    <AppShell {...shell}>
      <div className="mx-auto max-w-5xl">
        <PageHeader
          eyebrow="Installation"
          title="Installation board"
          description="Jobs that need a site visit, with schedule, installers and open snags."
          actions={
            <Link href="/admin/installations/calendar">
              <Button variant="outline">Team calendar</Button>
            </Link>
          }
        />

        <form className="mb-6 grid gap-3 rounded-xl border border-neutral-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
          <select name="status" defaultValue={filters.status || ""} className="h-9 rounded-lg border border-neutral-300 px-2 text-sm">
            <option value="">All statuses</option>
            {Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            type="date"
            name="date"
            defaultValue={filters.date || ""}
            className="h-9 rounded-lg border border-neutral-300 px-2 text-sm"
            aria-label="Scheduled date"
          />
          <select name="installer" defaultValue={filters.installer || ""} className="h-9 rounded-lg border border-neutral-300 px-2 text-sm">
            <option value="">All installers</option>
            {installers.map((installer) => (
              <option key={installer.id} value={installer.id}>
                {installer.name}
              </option>
            ))}
          </select>
          <select name="customer" defaultValue={filters.customer || ""} className="h-9 rounded-lg border border-neutral-300 px-2 text-sm">
            <option value="">All customers</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
          <Button type="submit">Filter</Button>
        </form>

        {visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 px-4 py-8 text-sm text-neutral-600">
            No installation projects match these filters.
          </p>
        ) : (
          <div className="space-y-3">
            {visible.map((project) => {
              const visit = nextVisit(project);
              const openSnags = project.visits.reduce((sum, item) => sum + item.openSnagCount, 0);
              const installersOnJob = [
                ...new Map(
                  project.visits.flatMap((item) => item.assignees.map((person) => [person.profileId, person.name]))
                ).values(),
              ];
              return (
                <Link
                  key={project.id}
                  href={`/admin/installations/${project.id}`}
                  className="block rounded-xl border border-neutral-200 bg-white p-4 transition-colors hover:border-neutral-400"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-neutral-500">
                        {project.jobReference || "No job"} · {project.companyName}
                      </p>
                      <h2 className="text-lg font-semibold text-neutral-950">
                        {project.jobName || project.title}
                      </h2>
                    </div>
                    <span className="rounded-md bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-700">
                      {PROJECT_STATUS_LABELS[project.status as keyof typeof PROJECT_STATUS_LABELS] || project.status}
                    </span>
                  </div>
                  <dl className="mt-3 grid gap-2 text-sm text-neutral-700 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="text-xs text-neutral-500">Visit</dt>
                      <dd>{visit ? VISIT_STATUS_LABELS[visit.status as keyof typeof VISIT_STATUS_LABELS] || visit.status : "No visit"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-neutral-500">Site</dt>
                      <dd>{visit ? siteSummary(visit) : "Site not set"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-neutral-500">Scheduled</dt>
                      <dd>{formatLondonWhen(visit?.scheduledStartAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-neutral-500">Installers / snags</dt>
                      <dd>
                        {installersOnJob.join(", ") || "Unassigned"}
                        {openSnags > 0 ? ` · ${openSnags} open snag${openSnags === 1 ? "" : "s"}` : ""}
                      </dd>
                    </div>
                  </dl>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
