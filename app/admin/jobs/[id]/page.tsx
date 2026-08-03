import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminJobArtworkPanel } from "@/components/admin-job-artwork-panel";
import { AdminJobArtworkSourcePanel } from "@/components/admin-job-artwork-source-panel";
import { AdminJobDropboxPanel } from "@/components/admin-job-dropbox-panel";
import { ProductionManifestPanel } from "@/components/manifest/production-manifest-panel";
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
import { getAdminArtworkSourceLabel } from "@/lib/jobs/artwork-source";
import { isDropboxConfigured } from "@/lib/dropbox/client";
import { getJobProductionReadiness, loadManifestItemsForJob } from "@/lib/manifest/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type AdminJobDetailPageProps = {
  params: Promise<{ id: string }>;
};

function mapJobStatusToBadge(status: string) {
  switch (status) {
    case "awaiting_artwork":
      return "pending" as const;
    case "artwork_in_preparation":
      return "pending" as const;
    case "artwork_received":
      return "sent" as const;
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

  const [manifestResult, readiness] = await Promise.all([
    loadManifestItemsForJob(adminClient, id),
    getJobProductionReadiness(adminClient, id).catch(() => ({
      activeRequiredCount: 0,
      satisfiedCount: 0,
      isReady: false,
      hasOverride: false,
      label: "Unable to calculate readiness",
    })),
  ]);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title={detail.job.project_name}
          description={`${detail.job.job_reference} · ${detail.companyName}`}
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href={`/admin/jobs/${detail.job.id}/invoice`}>
                <Button variant="outline">Prepare invoice</Button>
              </Link>
              {detail.job.quote_id ? (
                <Link href={`/admin/quotes/${detail.job.quote_id}`}>
                  <Button variant="outline">
                    View quote{detail.quoteNumber ? ` Q-${detail.quoteNumber}` : ""}
                  </Button>
                </Link>
              ) : null}
            </div>
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
            <div>
              <p className="text-muted-foreground">Artwork source</p>
              <p className="mt-2 font-medium text-neutral-950">
                {getAdminArtworkSourceLabel(detail.job.artwork_source)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Artwork required</p>
              <p className="mt-2 font-medium text-neutral-950">
                {detail.job.artwork_required ? "Yes" : "No"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Dropbox setup</p>
              <p className="mt-2 font-medium text-neutral-950">
                {detail.job.dropbox_setup_status === "ready"
                  ? "Ready"
                  : detail.job.dropbox_setup_status === "failed"
                    ? "Failed"
                    : "Pending"}
              </p>
            </div>
            {detail.opportunityTitle ? (
              <div>
                <p className="text-muted-foreground">Opportunity</p>
                <p className="mt-2 font-medium text-neutral-950">
                  {detail.job.opportunity_id ? (
                    <Link
                      href={`/admin/opportunities/${detail.job.opportunity_id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {detail.opportunityTitle}
                    </Link>
                  ) : (
                    detail.opportunityTitle
                  )}
                </p>
              </div>
            ) : null}
            {detail.job.quote_request_id ? (
              <div>
                <p className="text-muted-foreground">Quote request</p>
                <p className="mt-2 font-medium text-neutral-950">
                  <Link
                    href={`/admin/quote-requests/${detail.job.quote_request_id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    View quote request
                  </Link>
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <AdminJobDropboxPanel
          jobId={detail.job.id}
          dropboxSetupStatus={detail.job.dropbox_setup_status}
          dropboxConfigured={isDropboxConfigured()}
        />

        <Card className="portal-surface mb-6 overflow-hidden">
          <CardContent className="pt-6">
            <AdminJobArtworkSourcePanel
              jobId={detail.job.id}
              artworkSource={detail.job.artwork_source}
            />
          </CardContent>
        </Card>

        <Card className="portal-surface mb-6 overflow-hidden">
          <CardContent className="pt-6">
            <ProductionManifestPanel
              jobId={detail.job.id}
              items={manifestResult.items}
              readiness={readiness}
              schemaMissing={manifestResult.schemaMissing}
              manifestMigrationMissing={manifestResult.manifestMigrationMissing}
            />
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
