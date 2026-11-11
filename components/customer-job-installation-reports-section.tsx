"use client";

import { useMemo, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CustomerInstallationReport } from "@/lib/installations/customer-reports";

function formatVisitDate(value: string | null) {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatPublishedDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function CustomerJobInstallationReportsSection({
  jobId,
  reports,
}: {
  jobId: string;
  reports: CustomerInstallationReport[];
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewUrl = useMemo(
    () =>
      previewId
        ? `/api/customer/jobs/${jobId}/installation-reports/${previewId}?inline=1`
        : null,
    [jobId, previewId]
  );

  if (reports.length === 0) {
    return (
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-neutral-950">Installation reports</h2>
        <p className="text-sm text-muted-foreground">No installation completion reports are available yet.</p>
      </section>
    );
  }

  return (
    <section className="space-y-4" id="installation-reports">
      <div>
        <h2 className="text-lg font-semibold text-neutral-950">Installation reports</h2>
        <p className="text-sm text-muted-foreground">
          Published installation completion reports for this job.
        </p>
      </div>
      <ul className="space-y-3">
        {reports.map((report) => (
          <li
            key={report.id}
            id={`installation-report-${report.id}`}
            className="rounded-xl border border-neutral-200 bg-white p-4"
          >
            <ReportCard
              report={report}
              jobId={jobId}
              previewActive={previewId === report.id}
              onPreview={() => setPreviewId(report.id)}
              onClosePreview={() => setPreviewId(null)}
            />
          </li>
        ))}
      </ul>
      {previewUrl ? (
        <iframe
          title="Installation report preview"
          src={previewUrl}
          className="h-[70vh] w-full rounded-xl border border-neutral-200"
        />
      ) : null}
    </section>
  );
}

function ReportCard({
  report,
  jobId,
  previewActive,
  onPreview,
  onClosePreview,
}: {
  report: CustomerInstallationReport;
  jobId: string;
  previewActive: boolean;
  onPreview: () => void;
  onClosePreview: () => void;
}) {
  return (
    <>
      <p className="text-base font-semibold text-neutral-950">{report.reportReference}</p>
      <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Visit</dt>
          <dd className="font-medium text-neutral-950">
            Visit {report.visitNumber}: {report.visitTitle}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Visit date</dt>
          <dd className="font-medium text-neutral-950">{formatVisitDate(report.visitCompletedAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Published</dt>
          <dd className="font-medium text-neutral-950">{formatPublishedDate(report.publishedAt)}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={previewActive ? onClosePreview : onPreview}>
          {previewActive ? "Close preview" : "Preview"}
        </Button>
        <a
          href={`/api/customer/jobs/${jobId}/installation-reports/${report.id}`}
          className={cn(buttonVariants({ variant: "default" }))}
        >
          Download PDF
        </a>
      </div>
    </>
  );
}
