"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  PROOF_FILE_LOCATION_LABELS,
  type ProofFileLocationType,
} from "@/lib/proofs/constants";
import { PROOF_UPLOAD_MAX_BYTES_LABEL } from "@/lib/proofs/file-validation";
import { getSourceArtworkFile } from "@/lib/proofs/proof-files";
import { canEditProofAttachment } from "@/lib/proofs/workflow-policy";
import { revisionCreatesNewImmutableVersion } from "@/lib/proofs/versioning";
import type { JobProofFileView, JobProofView } from "@/lib/proofs/types";

type DropboxListFile = {
  id: string;
  name: string;
  path: string;
  size: number;
};

type ProofFileAttachmentPanelProps = {
  jobId: string;
  proof: JobProofView;
  dropboxLinked: boolean;
  jobFiles: Array<{ id: string; file_name: string; upload_status: string }>;
  pending: boolean;
  onPendingChange: (pending: boolean) => void;
  onError: (message: string | null) => void;
  onRefresh: () => Promise<void>;
  forceShowAttach?: boolean;
  onAttachFormOpened?: () => void;
};

type AttachSource =
  | "customer_artwork"
  | "working_file"
  | "proofs_folder"
  | "upload";

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function locationLabel(locationType: ProofFileLocationType | null) {
  if (!locationType) {
    return "Unknown";
  }
  return PROOF_FILE_LOCATION_LABELS[locationType];
}

export function ProofFileAttachmentPanel({
  jobId,
  proof,
  dropboxLinked,
  jobFiles,
  pending,
  onPendingChange,
  onError,
  onRefresh,
  forceShowAttach = false,
  onAttachFormOpened,
}: ProofFileAttachmentPanelProps) {
  const [showAttach, setShowAttach] = useState(false);
  const [attachSource, setAttachSource] = useState<AttachSource>("customer_artwork");
  const [sourceJobFileId, setSourceJobFileId] = useState("");
  const [dropboxSourcePath, setDropboxSourcePath] = useState("");
  const [dropboxFiles, setDropboxFiles] = useState<DropboxListFile[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  useEffect(() => {
    if (!forceShowAttach) {
      return;
    }

    setShowAttach(true);
    setAttachSource("customer_artwork");
    onAttachFormOpened?.();
  }, [forceShowAttach, onAttachFormOpened]);

  const proofFile = getSourceArtworkFile(proof.files);
  const completeJobFiles = jobFiles.filter((file) => file.upload_status === "complete");
  const canEditAttachment = canEditProofAttachment(proof);
  const attachmentLockedForRevision =
    !canEditAttachment &&
    Boolean(proofFile) &&
    (revisionCreatesNewImmutableVersion(proof.status) ||
      Boolean(proof.brandedPdfGeneratedAt));

  async function loadDropboxFiles(mode: "working_file" | "proofs_folder") {
    if (!dropboxLinked) {
      setDropboxFiles([]);
      return;
    }

    onError(null);
    const response = await fetch(`/api/admin/jobs/${jobId}/proofs`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        mode === "proofs_folder"
          ? { listFolder: "proofs_folder" }
          : { artworkOrigin: "candid_created" }
      ),
    });

    const payload = (await response.json()) as {
      files?: DropboxListFile[];
      error?: string;
    };

    if (!response.ok) {
      onError(payload.error ?? "Unable to load Dropbox files.");
      return;
    }

    setDropboxFiles(payload.files ?? []);
  }

  async function attachFromSource() {
    onError(null);
    onPendingChange(true);

    let response: Response;

    if (attachSource === "upload") {
      if (!uploadFile) {
        onPendingChange(false);
        onError("Select a proof PDF or image to upload.");
        return;
      }

      const formData = new FormData();
      formData.set("file", uploadFile);

      response = await fetch(
        `/api/admin/jobs/${jobId}/proofs/${proof.id}/file/upload`,
        {
          method: "POST",
          body: formData,
        }
      );
    } else {
      response = await fetch(`/api/admin/jobs/${jobId}/proofs/${proof.id}/file`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: attachSource,
          sourceJobFileId:
            attachSource === "customer_artwork" ? sourceJobFileId : undefined,
          dropboxSourcePath:
            attachSource === "working_file" || attachSource === "proofs_folder"
              ? dropboxSourcePath
              : undefined,
        }),
      });
    }

    const payload = (await response.json()) as { error?: string };
    onPendingChange(false);

    if (!response.ok) {
      onError(payload.error ?? "Unable to attach proof file.");
      return;
    }

    setShowAttach(false);
    setSourceJobFileId("");
    setDropboxSourcePath("");
    setUploadFile(null);
    await onRefresh();
  }

  async function removeAttachment() {
    onError(null);
    onPendingChange(true);

    const response = await fetch(`/api/admin/jobs/${jobId}/proofs/${proof.id}/file`, {
      method: "DELETE",
    });

    const payload = (await response.json()) as { error?: string };
    onPendingChange(false);

    if (!response.ok) {
      onError(payload.error ?? "Unable to remove proof file.");
      return;
    }

    await onRefresh();
  }

  if (!canEditAttachment && !proofFile) {
    return null;
  }

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Source artwork</p>
        {canEditAttachment && !showAttach ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              setShowAttach(true);
              setAttachSource(proofFile ? "upload" : "customer_artwork");
            }}
          >
            {proofFile ? "Replace attachment" : "Attach proof artwork"}
          </Button>
        ) : null}
      </div>

      {proofFile ? (
        <dl className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Filename</dt>
            <dd className="font-medium">{proofFile.file_name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">File size</dt>
            <dd>{formatFileSize(Number(proofFile.file_size_bytes ?? 0))}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Dropbox location</dt>
            <dd>{locationLabel(proofFile.location_type)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Used for</dt>
            <dd>Preflight analysis and branded PDF generation</dd>
          </div>
          {canEditAttachment ? (
            <div className="pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={removeAttachment}
              >
                Remove attachment
              </Button>
            </div>
          ) : attachmentLockedForRevision ? (
            <p className="pt-1 text-xs text-muted-foreground">
              This version already has a generated customer proof or has passed internal send
              readiness. Use Create revised proof to start the next version with new artwork.
            </p>
          ) : null}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">No proof file attached yet.</p>
      )}

      {showAttach && canEditAttachment ? (
        <div className="space-y-4 rounded-lg border border-border p-3">
          {!dropboxLinked ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              No Dropbox folder is linked to this job yet.
            </p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor={`attach-source-${proof.id}`}>Attach from</Label>
            <select
              id={`attach-source-${proof.id}`}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={attachSource}
              onChange={async (event) => {
                const nextSource = event.target.value as AttachSource;
                setAttachSource(nextSource);
                setSourceJobFileId("");
                setDropboxSourcePath("");
                setUploadFile(null);
                setDropboxFiles([]);

                if (nextSource === "working_file") {
                  await loadDropboxFiles("working_file");
                } else if (nextSource === "proofs_folder") {
                  await loadDropboxFiles("proofs_folder");
                }
              }}
            >
              <option value="customer_artwork">Customer artwork</option>
              <option value="working_file">Candid working file</option>
              <option value="proofs_folder">Existing file in 03 Proofs</option>
              <option value="upload">Upload proof PDF/image</option>
            </select>
          </div>

          {attachSource === "customer_artwork" ? (
            <div className="space-y-2">
              <Label htmlFor={`attach-job-file-${proof.id}`}>Customer artwork file</Label>
              {completeJobFiles.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No completed customer artwork uploads on this job yet.
                </p>
              ) : (
                <select
                  id={`attach-job-file-${proof.id}`}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={sourceJobFileId}
                  onChange={(event) => setSourceJobFileId(event.target.value)}
                >
                  <option value="">Select a file</option>
                  {completeJobFiles.map((file) => (
                    <option key={file.id} value={file.id}>
                      {file.file_name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : null}

          {attachSource === "working_file" ? (
            <div className="space-y-2">
              <Label>Candid working file</Label>
              {!dropboxLinked ? (
                <p className="text-sm text-muted-foreground">
                  Link a Dropbox folder to this job before selecting working files.
                </p>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => loadDropboxFiles("working_file")}
                  >
                    Refresh working files
                  </Button>
                  <select
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    value={dropboxSourcePath}
                    onChange={(event) => setDropboxSourcePath(event.target.value)}
                  >
                    <option value="">Select a file</option>
                    {dropboxFiles.map((file) => (
                      <option key={file.path} value={file.path}>
                        {file.name} ({formatFileSize(file.size)})
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          ) : null}

          {attachSource === "proofs_folder" ? (
            <div className="space-y-2">
              <Label>Existing file in 03 Proofs</Label>
              {!dropboxLinked ? (
                <p className="text-sm text-muted-foreground">
                  Link a Dropbox folder to this job before selecting proof files.
                </p>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => loadDropboxFiles("proofs_folder")}
                  >
                    Refresh proofs folder
                  </Button>
                  <select
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    value={dropboxSourcePath}
                    onChange={(event) => setDropboxSourcePath(event.target.value)}
                  >
                    <option value="">Select a file</option>
                    {dropboxFiles.map((file) => (
                      <option key={file.path} value={file.path}>
                        {file.name} ({formatFileSize(file.size)})
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          ) : null}

          {attachSource === "upload" ? (
            <div className="space-y-2">
              <Label htmlFor={`attach-upload-${proof.id}`}>Upload proof PDF/image</Label>
              <p className="text-xs text-muted-foreground">
                PDF, JPG, or PNG only. Maximum size {PROOF_UPLOAD_MAX_BYTES_LABEL}. AI/EPS
                production files are not accepted here.
              </p>
              {!dropboxLinked ? (
                <p className="text-sm text-muted-foreground">
                  Link a Dropbox folder to this job before uploading proof files.
                </p>
              ) : (
                <input
                  id={`attach-upload-${proof.id}`}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  className="block w-full text-sm"
                  onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                />
              )}
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={attachFromSource}>
              Save attachment
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setShowAttach(false);
                setUploadFile(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
