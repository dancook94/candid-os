import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminJobArtworkPanel } from "@/components/admin-job-artwork-panel";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { isMissingJobsSchemaError } from "@/lib/jobs/errors";
import { loadAdminJobDetail } from "@/lib/jobs/loaders";
import { JOB_STATUS_LABELS } from "@/lib/jobs/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type AdminJobDetailPageProps = {
  params: Promise<{ id: string }>;
};

function mapJobStatusToBadge(status: string) {
  switch (status) {
    case "awaiting_artwork":
      return "pending" as const;
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

export default async function AdminJobDetailPage({
  params,
}: AdminJobDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(supabase, `/admin/jobs/${id}`);
  const adminClient = createAdminClient();

  let detail: Awaited<ReturnType<typeof loadAdminJobDetail>> = null;

  try {
    detail = await loadAdminJobDetail(adminClient, id);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      isMissingJobsSchemaError(error as { code?: string; message?: string })
    ) {
      notFound();
    }

    throw error;
  }

  if (!detail) {
    notFound();
  }

  const shellProps = await buildAdminAppShellProps(supabase, profile);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title={detail.job.project_name}
          description={`${detail.job.job_reference} · ${detail.companyName}`}
          actions={
            detail.job.quote_id ? (
              <Link href={`/admin/quotes/${detail.job.quote_id}`}>
                <Button variant="outline">
                  View quote{detail.quoteNumber ? ` Q-${detail.quoteNumber}` : ""}
                </Button>
              </Link>
            ) : null
          }
        />

        <Card className="portal-surface mb-6 overflow-hidden">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold">Job overview</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 pt-6 text-sm md:grid-cols-2">
            <div>
              <p className="text-muted-foreground">Status</p>
              <div className="mt-2">
                <StatusBadge
                  status={mapJobStatusToBadge(detail.job.status)}
                  label={JOB_STATUS_LABELS[detail.job.status] ?? detail.job.status}
                />
              </div>
            </div>
            <div>
              <p className="text-muted-foreground">Company</p>
              <p className="mt-2 font-medium text-neutral-950">{detail.companyName}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="portal-surface overflow-hidden">
          <CardContent className="pt-6">
            <AdminJobArtworkPanel jobId={detail.job.id} files={detail.files} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
