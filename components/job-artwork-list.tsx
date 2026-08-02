"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import {
  getArtworkTableStatusLabel,
  mapArtworkTableStatusToBadge,
} from "@/lib/jobs/upload-status-display";
import {
  formatArtworkCustomerNote,
  formatArtworkUploadedAt,
} from "@/lib/jobs/artwork-display";
import type { CustomerJobFileView } from "@/lib/jobs/types";
import { formatFileSize } from "@/lib/quote-request-attachments";
import { JobArtworkUploader } from "@/components/job-artwork-uploader";

function getCustomerArtworkStatusLabel(file: CustomerJobFileView) {
  return getArtworkTableStatusLabel(file.uploadStatus, file.artworkStatus);
}

function mapArtworkStatusToBadge(file: CustomerJobFileView) {
  return mapArtworkTableStatusToBadge(file.uploadStatus, file.artworkStatus);
}

type JobArtworkListProps = {
  jobId: string;
  files: CustomerJobFileView[];
  dropboxConfigured: boolean;
  showArtworkRequired?: boolean;
  customerArtworkMessage?: string | null;
  onChanged?: () => void;
};

export function JobArtworkList({
  jobId,
  files,
  dropboxConfigured,
  showArtworkRequired = false,
  customerArtworkMessage = null,
  onChanged,
}: JobArtworkListProps) {
  const [replaceFileId, setReplaceFileId] = useState<string | null>(null);

  return (
    <div className="space-y-8">
      {showArtworkRequired ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-base font-semibold text-amber-950">Artwork required</p>
          <p className="mt-1 text-sm text-amber-900">
            Please upload the artwork required for this job.
          </p>
        </div>
      ) : null}

      {customerArtworkMessage ? (
        <div className="rounded-xl border border-border bg-muted/30 px-5 py-4">
          <p className="text-sm text-neutral-900">{customerArtworkMessage}</p>
        </div>
      ) : null}

      <JobArtworkUploader
        jobId={jobId}
        enabled={dropboxConfigured}
        disabledMessage={
          dropboxConfigured
            ? null
            : "Artwork upload is temporarily unavailable. Please contact Candid Creative."
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
                        status={mapArtworkStatusToBadge(file)}
                        label={getCustomerArtworkStatusLabel(file)}
                      />
                    </td>
                    <td className="p-4 text-muted-foreground">
                      {formatArtworkUploadedAt(file.uploadedAt)}
                    </td>
                    <td className="p-4 text-muted-foreground">
                      {file.uploadedByName ?? "—"}
                    </td>
                    <td className="p-4 text-muted-foreground">
                      {formatFileSize(file.fileSizeBytes)}
                    </td>
                    <td className="p-4 text-muted-foreground">
                      {formatArtworkCustomerNote(file.customerNotes)}
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
