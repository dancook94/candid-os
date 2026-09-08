import Link from "next/link";

import { PrintfactoryThumbnailImage } from "@/components/production/printfactory-thumbnail";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { JobPrintfactoryPreviewBundle } from "@/lib/printfactory/job-previews";

type AdminJobPrintfactoryPreviewPanelProps = {
  jobReference: string;
  previewBundle: JobPrintfactoryPreviewBundle;
};

function PreviewMeta({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value?.trim()) {
    return null;
  }

  return (
    <p>
      <span className="font-medium text-foreground">{label}:</span>{" "}
      <span className="text-muted-foreground">{value}</span>
    </p>
  );
}

export function AdminJobPrintfactoryPreviewPanel({
  jobReference,
  previewBundle,
}: AdminJobPrintfactoryPreviewPanelProps) {
  const { previews } = previewBundle;

  if (previews.length === 0) {
    return (
      <Card className="portal-surface mb-6 overflow-hidden">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-lg font-semibold">PrintFactory Preview</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          No ripped PrintFactory previews are linked to {jobReference} yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="portal-surface mb-6 overflow-hidden">
      <CardHeader className="border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg font-semibold">PrintFactory Preview</CardTitle>
          <Link
            href={`/admin/production/printfactory-unmatched?job=${encodeURIComponent(jobReference)}`}
            className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
          >
            Open PrintFactory matching
          </Link>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
        {previews.map((preview) => (
          <div
            key={preview.id}
            className="space-y-3 rounded-xl border border-border bg-card p-3"
          >
            {preview.isSharedPrint ? (
              <p className="text-xs font-medium text-muted-foreground">
                Shared PrintFactory output · {preview.linkedJobCount} jobs
              </p>
            ) : null}
            <PrintfactoryThumbnailImage
              src={preview.thumbnailUrl}
              alt={preview.fileName ?? preview.jobName ?? "PrintFactory preview"}
              maxHeightClassName="max-h-48"
              showUnavailableFallback
              enlargeable
            />
            <div className="space-y-1 text-sm">
              <PreviewMeta label="PrintFactory job" value={preview.jobName} />
              <PreviewMeta label="File" value={preview.fileName} />
              <PreviewMeta label="Device" value={preview.device} />
              <PreviewMeta label="Media" value={preview.mediaType} />
              <PreviewMeta
                label="Status"
                value={
                  preview.printfactoryStatus
                    ? `${preview.printfactoryStatus}${preview.progress != null ? ` (${preview.progress}%)` : ""}`
                    : null
                }
              />
              {preview.otherLinkedJobs.length > 0 ? (
                <div className="pt-2">
                  <p className="font-medium text-foreground">Also linked to:</p>
                  <ul className="mt-1 space-y-1">
                    {preview.otherLinkedJobs.map((job) => (
                      <li key={job.id}>
                        <Link
                          href={`/admin/jobs/${job.id}`}
                          className="text-muted-foreground underline-offset-4 hover:underline"
                        >
                          {job.jobReference} — {job.projectName}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
