import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { fetchAdminJobsList } from "@/lib/admin-jobs-list";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function mapJobStatusToBadge(status: string) {
  switch (status) {
    case "awaiting_artwork":
      return "pending" as const;
    case "artwork_uploaded":
      return "sent" as const;
    case "in_production":
      return "sent" as const;
    case "ready":
      return "approved" as const;
    case "completed":
      return "accepted" as const;
    default:
      return "draft" as const;
  }
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function AdminJobsPage() {
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(supabase, "/admin/jobs");
  const { jobs, schemaMissing, loadError } = await fetchAdminJobsList(supabase);
  const shellProps = await buildAdminAppShellProps(supabase, profile);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          eyebrow="Administration"
          title="Jobs"
          description="Production jobs created from accepted quotes."
        />

        {loadError ? (
          <Card className="portal-surface mb-6 border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <p className="text-sm font-medium text-red-800">Unable to load jobs</p>
              <p className="mt-1 text-sm text-red-700">{loadError}</p>
            </CardContent>
          </Card>
        ) : null}

        {schemaMissing ? (
          <Card className="portal-surface mb-6">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                The jobs table is not deployed in Supabase yet. Apply{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  supabase/migrations/20260802190000_jobs_foundation.sql
                </code>{" "}
                in the SQL editor, then use Create missing job on an accepted quote.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {jobs.length === 0 && !loadError && !schemaMissing ? (
          <EmptyState
            title="No jobs yet"
            description="Jobs appear here when a quote is accepted and converted to production."
          />
        ) : jobs.length > 0 ? (
          <Card className="portal-surface overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Project</th>
                      <th>Company</th>
                      <th>Status</th>
                      <th>Quote</th>
                      <th>Artwork</th>
                      <th>Dropbox</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.id} className="hover:bg-muted/35">
                        <td className="p-4 font-medium text-foreground">
                          <Link
                            href={`/admin/jobs/${job.id}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {job.reference}
                          </Link>
                        </td>
                        <td className="p-4 text-muted-foreground">{job.projectTitle}</td>
                        <td className="p-4 text-muted-foreground">{job.companyName}</td>
                        <td className="p-4">
                          <StatusBadge
                            status={mapJobStatusToBadge(job.status)}
                            label={job.statusLabel}
                          />
                        </td>
                        <td className="p-4 text-muted-foreground">
                          {job.quoteNumber ? (
                            <Link
                              href={`/admin/quotes/${job.quoteId}`}
                              className="underline-offset-4 hover:underline"
                            >
                              {job.quoteNumber}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-4 text-muted-foreground">
                          {job.artworkRequired ? "Required" : "Not required"}
                        </td>
                        <td className="p-4 text-muted-foreground">
                          {job.dropboxSetupStatus === "ready"
                            ? "Ready"
                            : job.dropboxSetupStatus === "failed"
                              ? "Failed"
                              : "Pending"}
                        </td>
                        <td className="p-4 text-muted-foreground">
                          {formatDate(job.updatedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
