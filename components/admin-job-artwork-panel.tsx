"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { formatFileSize } from "@/lib/quote-request-attachments";

type AdminJobFile = {
  id: string;
  file_name: string;
  version_number: number;
  artwork_status: string;
  artworkStatusLabel: string;
  upload_status: string;
  customer_notes: string | null;
  internal_notes: string | null;
  changes_required_comment: string | null;
  uploaded_at: string | null;
  uploadedByName: string | null;
  file_size_bytes: number;
};

type AdminJobArtworkPanelProps = {
  jobId: string;
  files: AdminJobFile[];
};

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

export function AdminJobArtworkPanel({ jobId, files }: AdminJobArtworkPanelProps) {
  const [pendingFileId, setPendingFileId] = useState<string | null>(null);
  const [changesComments, setChangesComments] = useState<Record<string, string>>({});
  const [internalNotesByFile, setInternalNotesByFile] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function updateStatus(
    fileId: string,
    artworkStatus: string,
    options?: { changesRequiredComment?: string; internalNotes?: string }
  ) {
    setError(null);
    setPendingFileId(fileId);

    const response = await fetch(`/api/admin/jobs/${jobId}/files/${fileId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artworkStatus,
        changesRequiredComment: options?.changesRequiredComment,
        internalNotes: options?.internalNotes,
      }),
    });

    const payload = (await response.json()) as { error?: string };
    setPendingFileId(null);

    if (!response.ok) {
      setError(payload.error ?? "Unable to update artwork status.");
      return;
    }

    window.location.reload();
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-neutral-950">Customer artwork</h2>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No customer artwork has been uploaded yet.
        </p>
      ) : (
        <div className="space-y-4">
          {files.map((file) => (
            <div
              key={file.id}
              className="rounded-xl border border-border bg-background p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-neutral-950">{file.file_name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Version {file.version_number} · {formatFileSize(file.file_size_bytes)} ·{" "}
                    {file.uploadedByName ?? "Unknown uploader"}
                  </p>
                  {file.customer_notes ? (
                    <p className="mt-2 text-sm text-neutral-950">
                      Customer note: {file.customer_notes}
                    </p>
                  ) : null}
                  {file.changes_required_comment ? (
                    <p className="mt-2 text-sm text-amber-900">
                      Changes requested: {file.changes_required_comment}
                    </p>
                  ) : null}
                  {file.internal_notes ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Internal notes: {file.internal_notes}
                    </p>
                  ) : null}
                </div>
                <StatusBadge
                  status={mapArtworkStatusToBadge(file.artwork_status)}
                  label={file.artworkStatusLabel}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {file.upload_status === "complete" ? (
                  <a href={`/api/admin/jobs/${jobId}/files/${file.id}`}>
                    <Button type="button" variant="outline" size="sm">
                      Download
                    </Button>
                  </a>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pendingFileId === file.id}
                  onClick={() => updateStatus(file.id, "under_review")}
                >
                  Start review
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pendingFileId === file.id}
                  onClick={() =>
                    updateStatus(file.id, "approved", {
                      internalNotes: internalNotesByFile[file.id],
                    })
                  }
                >
                  Approve
                </Button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`changes-${file.id}`}>Customer-facing comment</Label>
                  <Input
                    id={`changes-${file.id}`}
                    value={changesComments[file.id] ?? ""}
                    onChange={(event) =>
                      setChangesComments((current) => ({
                        ...current,
                        [file.id]: event.target.value,
                      }))
                    }
                    placeholder="Required when requesting changes"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`internal-${file.id}`}>Internal notes</Label>
                  <Input
                    id={`internal-${file.id}`}
                    value={internalNotesByFile[file.id] ?? ""}
                    onChange={(event) =>
                      setInternalNotesByFile((current) => ({
                        ...current,
                        [file.id]: event.target.value,
                      }))
                    }
                    placeholder="Internal review notes"
                  />
                </div>
              </div>

              <div className="mt-3">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pendingFileId === file.id}
                  onClick={() =>
                    updateStatus(file.id, "changes_required", {
                      changesRequiredComment: changesComments[file.id],
                      internalNotes: internalNotesByFile[file.id],
                    })
                  }
                >
                  Request changes
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
