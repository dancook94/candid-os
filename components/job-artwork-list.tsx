"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { CUSTOMER_ARTWORK_STATUS_LABELS } from "@/lib/jobs/constants";
import type { CustomerJobFileView } from "@/lib/jobs/types";
import { formatFileSize } from "@/lib/quote-request-attachments";
import { JobArtworkUploader } from "@/components/job-artwork-uploader";

function getCustomerArtworkStatusLabel(status: string) {
  return CUSTOMER_ARTWORK_STATUS_LABELS[status] ?? status;
}

type JobArtworkListProps = {
  jobId: string;
  files: CustomerJobFileView[];
  dropboxConfigured: boolean;
  onChanged?: () => void;
};

function formatDate(dateString: string | null) {
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

function mapArtworkStatusToBadge(status: string) {
  switch (status) {
    case "approved":
      return "approved" as const;
    case "changes_required":
      return "declined" as const;
    case "under_review":
      return "pending" as const;
    case "superseded":
      return "disabled" as const;
    default:
      return "draft" as const;
  }
}

export function JobArtworkList({
  jobId,
  files,
  dropboxConfigured,
  onChanged,
}: JobArtworkListProps) {
  const [replaceFileId, setReplaceFileId] = useState<string | null>(null);

  return (
    <div className="space-y-8">
      <JobArtworkUploader
        jobId={jobId}
        enabled={dropboxConfigured}
        disabledMessage={
          dropboxConfigured
            ? null
            : "Dropbox integration is not configured."
        }
        replaceFileId={replaceFileId}
        onComplete={() => {
          setReplaceFileId(null);
          onChanged?.();
        }}
      />

      <div className="space-y-4">
        <h3 className="text-base font-semibold text-neutral-950">Uploaded artwork</h3>

        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No artwork has been uploaded for this job yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Uploaded</th>
                  <th>Uploaded by</th>
                  <th>Size</th>
                  <th>Note</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id}>
                    <td className="p-4 font-medium text-foreground">{file.fileName}</td>
                    <td className="p-4 text-muted-foreground">v{file.versionNumber}</td>
                    <td className="p-4">
                      <StatusBadge
                        status={mapArtworkStatusToBadge(file.artworkStatus)}
                        label={getCustomerArtworkStatusLabel(file.artworkStatus)}
                      />
                    </td>
                    <td className="p-4 text-muted-foreground">
                      {formatDate(file.uploadedAt)}
                    </td>
                    <td className="p-4 text-muted-foreground">
                      {file.uploadedByName ?? "—"}
                    </td>
                    <td className="p-4 text-muted-foreground">
                      {formatFileSize(file.fileSizeBytes)}
                    </td>
                    <td className="p-4 text-muted-foreground">
                      {file.customerNotes ?? "—"}
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-2">
                        {file.uploadStatus === "complete" ? (
                          <a
                            href={`/api/customer/jobs/${jobId}/files/${file.id}/download`}
                            className="inline-flex"
                          >
                            <Button type="button" variant="outline" size="sm">
                              Download
                            </Button>
                          </a>
                        ) : null}
                        {file.canReplace ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setReplaceFileId(file.id)}
                          >
                            Replace
                          </Button>
                        ) : null}
                        {file.canRemove ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              const response = await fetch(
                                `/api/customer/jobs/${jobId}/files/${file.id}/remove`,
                                { method: "POST" }
                              );

                              if (response.ok) {
                                onChanged?.();
                              }
                            }}
                          >
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
