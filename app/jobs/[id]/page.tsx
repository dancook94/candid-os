import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { CustomerJobArtworkSection } from "@/components/customer-job-artwork-section";
import { CustomerJobProofsSection } from "@/components/proofs/customer-job-proofs-section";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireCustomerSettingsContext } from "@/lib/customer-settings/auth";
import { loadCustomerJobDetail } from "@/lib/jobs/loaders";
import { loadCustomerJobProofingContext } from "@/lib/proofs/loaders";
import {
  buildCustomerAppShellProps,
  requireCustomerPortalUser,
} from "@/lib/customer-shell-props";
import { createClient } from "@/lib/supabase/server";

type CustomerJobDetailPageProps = {
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

function formatDate(dateString: string | null) {
  if (!dateString) {
    return "—";
  }

  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function CustomerJobDetailPage({
  params,
}: CustomerJobDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const profile = await requireCustomerPortalUser(supabase, user, redirect);

  if (profile.account_status !== "approved" || !profile.company_id) {
    redirect("/jobs");
  }

  await requireCustomerSettingsContext(supabase, user);

  const [job, proofing] = await Promise.all([
    loadCustomerJobDetail(supabase, profile.company_id, id),
    loadCustomerJobProofingContext(id),
  ]);

  if (!job) {
    notFound();
  }

  const shellProps = await buildCustomerAppShellProps(supabase, user, profile);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title={job.projectTitle}
          description={`Job ${job.reference}`}
          actions={
            <Link href="/jobs">
              <Button variant="outline">Back to jobs</Button>
            </Link>
          }
        />

        <Card className="portal-surface mb-6 overflow-hidden">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold">Job details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 pt-6 text-sm md:grid-cols-2">
            <div>
              <p className="text-muted-foreground">Status</p>
              <div className="mt-2">
                <StatusBadge
                  status={mapJobStatusToBadge(job.status)}
                  label={job.statusLabel}
                />
              </div>
            </div>
            <div>
              <p className="text-muted-foreground">Required date</p>
              <p className="mt-2 font-medium text-neutral-950">
                {formatDate(job.requiredDate)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Fulfilment</p>
              <p className="mt-2 font-medium text-neutral-950">
                {job.fulfilmentMethod === "collection" ? "Collection" : "Delivery"}
              </p>
            </div>
            {job.fulfilmentMethod === "delivery" && job.deliveryDetails ? (
              <div className="md:col-span-2">
                <p className="text-muted-foreground">Delivery details</p>
                <p className="mt-2 font-medium text-neutral-950">{job.deliveryDetails}</p>
              </div>
            ) : null}
            <div>
              <p className="text-muted-foreground">Related quote</p>
              <p className="mt-2 font-medium text-neutral-950">
                {job.quoteNumber ? (
                  job.quoteLinkPublished ? (
                    <Link
                      href={`/quotes/${job.quoteId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {job.quoteNumber}
                    </Link>
                  ) : (
                    "Internal quote"
                  )
                ) : (
                  "—"
                )}
              </p>
            </div>
          </CardContent>
        </Card>

        {proofing.proofState.status === "changes_requested" &&
        proofing.proofState.changesRequestedComment ? (
          <Card className="portal-surface mb-6 overflow-hidden border-amber-200 bg-amber-50">
            <CardContent className="pt-6">
              <p className="text-base font-semibold text-amber-950">
                Proof changes requested
              </p>
              <p className="mt-2 text-sm text-amber-900">
                {proofing.proofState.changesRequestedComment}
              </p>
            </CardContent>
          </Card>
        ) : null}

        {job.changesRequiredComment ? (
          <Card className="portal-surface mb-6 overflow-hidden border-amber-200 bg-amber-50">
            <CardContent className="pt-6">
              <p className="text-base font-semibold text-amber-950">
                Artwork changes required
              </p>
              <p className="mt-2 text-sm text-amber-900">{job.changesRequiredComment}</p>
            </CardContent>
          </Card>
        ) : null}

        <Card className="portal-surface mb-6 overflow-hidden">
          <CardContent className="pt-6">
            <CustomerJobProofsSection
              jobId={job.id}
              proofRequired={proofing.proofRequired}
              proofState={proofing.proofState}
              proofs={proofing.proofs}
              schemaMissing={proofing.schemaMissing}
            />
          </CardContent>
        </Card>

        <Card className="portal-surface overflow-hidden">
          <CardContent className="pt-6">
            <CustomerJobArtworkSection job={job} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
