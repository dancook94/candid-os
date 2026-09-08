import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import {
  fetchAdminProblemReports,
  summarizeProblemReportDescription,
} from "@/lib/problem-reports/queries";
import {
  formatProblemReportPriorityLabel,
  formatProblemReportStatusLabel,
  PROBLEM_REPORT_PRIORITIES,
  PROBLEM_REPORT_STATUSES,
} from "@/lib/updates/types";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AdminProblemReportsPageProps = {
  searchParams: Promise<{
    status?: string;
    priority?: string;
    reporterType?: string;
  }>;
};

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminProblemReportsPage({
  searchParams,
}: AdminProblemReportsPageProps) {
  const filters = await searchParams;
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(supabase, "/admin/problem-reports");
  const shellProps = await buildAdminAppShellProps(supabase, profile);

  const { reports, totalCount, schemaMissing, error } =
    await fetchAdminProblemReports(supabase, {
      status: filters.status,
      priority: filters.priority,
      reporterType:
        filters.reporterType === "staff" || filters.reporterType === "customer"
          ? filters.reporterType
          : undefined,
    });

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-7xl space-y-6">
        <PageHeader
          eyebrow="Administration"
          title="Problem reports"
          description="Review issues reported by staff and customers during the Candid OS pilot."
        />

        <Card className="portal-surface rounded-2xl shadow-sm ring-0">
          <CardContent className="p-4">
            <form method="get" className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="filter-status">Status</Label>
                <Select id="filter-status" name="status" defaultValue={filters.status ?? ""}>
                  <option value="">All statuses</option>
                  {PROBLEM_REPORT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {formatProblemReportStatusLabel(status)}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="filter-priority">Priority</Label>
                <Select
                  id="filter-priority"
                  name="priority"
                  defaultValue={filters.priority ?? ""}
                >
                  <option value="">All priorities</option>
                  {PROBLEM_REPORT_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {formatProblemReportPriorityLabel(priority)}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="filter-reporter-type">Reporter type</Label>
                <Select
                  id="filter-reporter-type"
                  name="reporterType"
                  defaultValue={filters.reporterType ?? ""}
                >
                  <option value="">All reporters</option>
                  <option value="staff">Staff</option>
                  <option value="customer">Customer</option>
                </Select>
              </div>

              <div className="md:col-span-3">
                <Button type="submit">Apply filters</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {schemaMissing ? (
          <Card className="rounded-2xl border-amber-200 bg-amber-50 shadow-sm ring-0">
            <CardContent className="p-6 text-sm text-amber-800">
              The problem reports migration has not been applied yet.
            </CardContent>
          </Card>
        ) : null}

        {!schemaMissing && error ? (
          <Card className="rounded-2xl border-red-200 bg-red-50 shadow-sm ring-0">
            <CardContent className="p-6 text-sm text-red-700">{error}</CardContent>
          </Card>
        ) : null}

        {!schemaMissing && !error && reports.length === 0 ? (
          <EmptyState
            title="No problem reports yet"
            description="Reports submitted from the Updates page will appear here."
          />
        ) : !schemaMissing && !error ? (
          <Card className="portal-surface overflow-hidden rounded-2xl shadow-sm ring-0">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Reporter</th>
                      <th>Company</th>
                      <th>Issue</th>
                      <th>Page</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((report) => (
                      <tr key={report.id}>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {formatDate(report.created_at)}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="font-medium text-foreground">
                            {report.reporter_name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {report.reporter_email}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {report.company_id ? "Linked" : "—"}
                        </td>
                        <td className="px-4 py-3.5">
                          {summarizeProblemReportDescription(report.description)}
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {report.source_path || "—"}
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {formatProblemReportPriorityLabel(report.priority)}
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {formatProblemReportStatusLabel(report.status)}
                        </td>
                        <td className="px-4 py-3.5">
                          <Link
                            href={`/admin/problem-reports/${report.id}`}
                            className="inline-flex h-7 items-center justify-center rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-muted"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {!schemaMissing && !error && totalCount > reports.length ? (
          <p className="text-sm text-muted-foreground">
            Showing {reports.length} of {totalCount} reports.
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}
