import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ProblemReportAdminForm } from "@/components/updates/problem-report-admin-form";
import { ProblemReportAttachmentLink } from "@/components/updates/problem-report-attachment-link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { fetchProblemReportAttachment } from "@/lib/problem-reports/attachments";
import { fetchProblemReportById } from "@/lib/problem-reports/queries";
import {
  formatProblemReportPriorityLabel,
  formatProblemReportStatusLabel,
} from "@/lib/updates/types";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AdminProblemReportDetailPageProps = {
  params: Promise<{ id: string }>;
};

function formatDateTime(dateString: string | null) {
  if (!dateString) {
    return "—";
  }

  return new Date(dateString).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminProblemReportDetailPage({
  params,
}: AdminProblemReportDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(
    supabase,
    `/admin/problem-reports/${id}`
  );
  const shellProps = await buildAdminAppShellProps(supabase, profile);

  const { report, error } = await fetchProblemReportById(supabase, id);

  if (error || !report) {
    notFound();
  }

  const { attachment } = await fetchProblemReportAttachment(supabase, id);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          eyebrow="Administration"
          title="Problem report"
          description="Review the reported issue and update its status."
          actions={
            <Link
              href="/admin/problem-reports"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Back to reports
            </Link>
          }
        />

        <Card className="portal-surface overflow-hidden rounded-2xl shadow-sm ring-0">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold">Report details</CardTitle>
            <CardDescription>
              Submitted {formatDateTime(report.created_at)}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5 pt-6">
            <div>
              <p className="text-sm font-medium text-foreground">What went wrong</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {report.description}
              </p>
            </div>

            {report.attempted_action ? (
              <div>
                <p className="text-sm font-medium text-foreground">
                  What they were trying to do
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                  {report.attempted_action}
                </p>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm font-medium text-foreground">Reporter</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {report.reporter_name}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Email</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {report.reporter_email}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Role</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {report.reporter_role}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Company</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {report.company_id ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Source page</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {report.source_path ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Priority</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatProblemReportPriorityLabel(report.priority)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Status</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatProblemReportStatusLabel(report.status)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Browser</p>
                <p className="mt-1 break-all text-sm text-muted-foreground">
                  {report.user_agent ?? "—"}
                </p>
              </div>
            </div>

            {attachment ? (
              <div>
                <p className="text-sm font-medium text-foreground">Attachment</p>
                <div className="mt-2">
                  <ProblemReportAttachmentLink
                    reportId={report.id}
                    fileName={attachment.file_name}
                  />
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="portal-surface overflow-hidden rounded-2xl shadow-sm ring-0">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold">Manage report</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <ProblemReportAdminForm report={report} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
