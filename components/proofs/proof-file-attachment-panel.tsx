"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  PROOF_FILE_LOCATION_LABELS,
  type ProofFileLocationType,
} from "@/lib/proofs/constants";
import {
  mergeCustomerArtworkDiscoveryFiles,
  type CustomerArtworkDiscoveryFile,
} from "@/lib/proofs/customer-artwork-discovery";
import {
  mapAttachFailureMessage,
  readAttachResponsePayload,
} from "@/lib/proofs/proof-attachment-utils";
import { getSourceArtworkFile } from "@/lib/proofs/proof-files";
import { getProofActions } from "@/lib/proofs/workflow-policy";
import { revisionCreatesNewImmutableVersion } from "@/lib/proofs/versioning";
import {
  PROOF_SOURCE_UPLOAD_ACCEPT,
  isProofSourceAttachExtension,
  isProofSourceDiscoveryBlockedExtension,
  proofGenerationCompatibilityLabel,
  proofSourceAttachExtensionError,
} from "@/lib/proofs/source-artwork-formats";
import { getJobArtworkMaxBytes } from "@/lib/jobs/constants";
import type { JobProofFileView, JobProofView } from "@/lib/proofs/types";

type DropboxListFile = {
  id: string;
  name: string;
  path: string;
  size: number;
};

type AttachSource = "customer_artwork" | "working_file" | "upload";

type ProofFileAttachmentPanelProps = {
  jobId: string;
  proof: JobProofView;
  dropboxLinked: boolean;
  jobFiles: Array<{
    id: string;
    file_name: string;
    upload_status: string;
    dropbox_path_lower?: string | null;
  }>;
  pending: boolean;
  onPendingChange: (pending: boolean) => void;
  onError: (message: string | null) => void;
  onRefresh: () => Promise<void>;
  forceShowAttach?: boolean;
  onAttachFormOpened?: () => void;
};

type UploadState = {
  file: File;
  progress: number;
  status: "idle" | "uploading" | "processing" | "error";
  error: string | null;
};

function formatFileSize(bytes: number) {
  if (bytes <= 0) {
    return "Unknown size";
  }

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

function formatMaxUploadLabel() {
  return `${Math.round(getJobArtworkMaxBytes() / (1024 * 1024))} MB`;
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
  const [customerArtworkFiles, setCustomerArtworkFiles] = useState<
    CustomerArtworkDiscoveryFile[]
  >([]);
  const [workingFiles, setWorkingFiles] = useState<DropboxListFile[]>([]);
  const [selectedCustomerPath, setSelectedCustomerPath] = useState("");
  const [selectedWorkingPath, setSelectedWorkingPath] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadState | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const uploadAbortRef = useRef(false);

  useEffect(() => {
    if (!forceShowAttach) {
      return;
    }

    setShowAttach(true);
    setAttachSource("customer_artwork");
    onAttachFormOpened?.();
  }, [forceShowAttach, onAttachFormOpened]);

  const proofFile = getSourceArtworkFile(proof.files);
  const proofActions = getProofActions(proof, []);
  const canEditAttachment = proofActions.canEditAttachment;
  const attachmentLockedForRevision =
    !canEditAttachment &&
    Boolean(proofFile) &&
    (revisionCreatesNewImmutableVersion(proof.status) ||
      Boolean(proof.brandedPdfGeneratedAt));

  function resetAttachSelection() {
    setSelectedCustomerPath("");
    setSelectedWorkingPath("");
    setUploadFile(null);
    setUploadState(null);
    uploadAbortRef.current = false;
  }

  function resetAttachForm() {
    resetAttachSelection();
    setShowAttach(false);
    onError(null);
  }

  async function loadCustomerArtworkFiles() {
    if (!dropboxLinked) {
      setCustomerArtworkFiles([]);
      return;
    }

    setLoadingFiles(true);
    onError(null);

    try {
      const response = await fetch(`/api/admin/jobs/${jobId}/proofs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artworkOrigin: "customer_uploaded" }),
      });

      const payload = (await readAttachResponsePayload(response)) as {
        files?: DropboxListFile[];
        error?: string;
      };

      if (!response.ok) {
        onError(payload.error ?? "Unable to load customer artwork files.");
        return;
      }

      setCustomerArtworkFiles(
        mergeCustomerArtworkDiscoveryFiles(payload.files ?? [], jobFiles)
      );
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "Unable to load customer artwork files."
      );
    } finally {
      setLoadingFiles(false);
    }
  }

  async function loadWorkingFiles() {
    if (!dropboxLinked) {
      setWorkingFiles([]);
      return;
    }

    setLoadingFiles(true);
    onError(null);

    try {
      const response = await fetch(`/api/admin/jobs/${jobId}/proofs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artworkOrigin: "candid_created" }),
      });

      const payload = (await readAttachResponsePayload(response)) as {
        files?: DropboxListFile[];
        error?: string;
      };

      if (!response.ok) {
        onError(payload.error ?? "Unable to load working files.");
        return;
      }

      setWorkingFiles(payload.files ?? []);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Unable to load working files."
      );
    } finally {
      setLoadingFiles(false);
    }
  }

  async function selectAttachSource(nextSource: AttachSource) {
    setAttachSource(nextSource);
    resetAttachSelection();
    onError(null);

    if (nextSource === "customer_artwork") {
      await loadCustomerArtworkFiles();
    } else if (nextSource === "working_file") {
      await loadWorkingFiles();
    }
  }

  async function attachDropboxSelection(
    source: "customer_artwork" | "working_file",
    dropboxSourcePath: string,
    sourceJobFileId?: string | null
  ) {
    onError(null);
    onPendingChange(true);

    try {
      const response = await fetch(`/api/admin/jobs/${jobId}/proofs/${proof.id}/file`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          dropboxSourcePath,
          sourceJobFileId: sourceJobFileId ?? undefined,
        }),
      });

      const payload = await readAttachResponsePayload(response);

      if (!response.ok) {
        onError(
          mapAttachFailureMessage(
            payload,
            response,
            "Unable to attach proof file."
          )
        );
        return;
      }

      resetAttachForm();
      await onRefresh();
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Unable to attach proof file."
      );
    } finally {
      onPendingChange(false);
    }
  }

  async function attachFromSource() {
    if (attachSource === "customer_artwork") {
      const selected = customerArtworkFiles.find(
        (file) => file.path === selectedCustomerPath
      );

      if (!selected) {
        onError("Select a customer artwork file.");
        return;
      }

      if (
        isProofSourceDiscoveryBlockedExtension(selected.name) ||
        !isProofSourceAttachExtension(selected.name)
      ) {
        onError(proofSourceAttachExtensionError(selected.name));
        return;
      }

      await attachDropboxSelection(
        "customer_artwork",
        selected.path,
        selected.jobFileId
      );
      return;
    }

    if (attachSource === "working_file") {
      const selected = workingFiles.find((file) => file.path === selectedWorkingPath);

      if (!selected) {
        onError("Select a Candid working file.");
        return;
      }

      if (
        isProofSourceDiscoveryBlockedExtension(selected.name) ||
        !isProofSourceAttachExtension(selected.name)
      ) {
        onError(proofSourceAttachExtensionError(selected.name));
        return;
      }

      await attachDropboxSelection("working_file", selected.path);
      return;
    }

    if (!uploadFile) {
      onError("Select a file to upload.");
      return;
    }

    if (!isProofSourceAttachExtension(uploadFile.name)) {
      onError(proofSourceAttachExtensionError(uploadFile.name));
      return;
    }

    await uploadAndAttachFile(uploadFile);
  }

  async function uploadAndAttachFile(file: File) {
    onError(null);
    onPendingChange(true);
    uploadAbortRef.current = false;

    setUploadState({
      file,
      progress: 0,
      status: "uploading",
      error: null,
    });

    try {
      const sessionResponse = await fetch(
        `/api/admin/jobs/${jobId}/proofs/${proof.id}/file/upload/session`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type || null,
            fileSizeBytes: file.size,
          }),
        }
      );

      const sessionPayload = (await readAttachResponsePayload(sessionResponse)) as {
        error?: string;
        sessionId?: string;
        dropboxPath?: string;
        chunkSizeBytes?: number;
      };

      if (!sessionResponse.ok || !sessionPayload.sessionId || !sessionPayload.dropboxPath) {
        const message = mapAttachFailureMessage(
          sessionPayload,
          sessionResponse,
          "Unable to start upload."
        );
        setUploadState({
          file,
          progress: 0,
          status: "error",
          error: message,
        });
        onError(message);
        return;
      }

      const chunkSize = sessionPayload.chunkSizeBytes ?? 4 * 1024 * 1024;
      let offset = 0;

      while (offset < file.size) {
        if (uploadAbortRef.current) {
          setUploadState({
            file,
            progress: Math.min(100, (offset / file.size) * 100),
            status: "error",
            error: "Upload cancelled.",
          });
          onError("Upload cancelled.");
          return;
        }

        const chunk = file.slice(offset, offset + chunkSize);
        const formData = new FormData();
        formData.set("chunk", chunk, file.name);
        formData.set("sessionId", sessionPayload.sessionId);
        formData.set("dropboxPath", sessionPayload.dropboxPath);
        formData.set("offset", String(offset));

        const chunkResponse = await fetch(
          `/api/admin/jobs/${jobId}/proofs/${proof.id}/file/upload/chunk`,
          {
            method: "POST",
            body: formData,
          }
        );

        const chunkPayload = (await readAttachResponsePayload(chunkResponse)) as {
          error?: string;
          uploadedBytes?: number;
        };

        if (!chunkResponse.ok) {
          const message = mapAttachFailureMessage(
            chunkPayload,
            chunkResponse,
            "Upload chunk failed."
          );
          setUploadState({
            file,
            progress: Math.min(100, (offset / file.size) * 100),
            status: "error",
            error: message,
          });
          onError(message);
          return;
        }

        offset = chunkPayload.uploadedBytes ?? offset + chunk.size;
        setUploadState({
          file,
          progress: Math.min(100, (offset / file.size) * 100),
          status: "uploading",
          error: null,
        });
      }

      setUploadState({
        file,
        progress: 100,
        status: "processing",
        error: null,
      });

      const finishResponse = await fetch(
        `/api/admin/jobs/${jobId}/proofs/${proof.id}/file/upload/session`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sessionPayload.sessionId,
            dropboxPath: sessionPayload.dropboxPath,
            fileName: file.name,
            mimeType: file.type || null,
            fileSizeBytes: file.size,
          }),
        }
      );

      const finishPayload = await readAttachResponsePayload(finishResponse);

      if (!finishResponse.ok) {
        const message = mapAttachFailureMessage(
          finishPayload,
          finishResponse,
          "Unable to finish upload."
        );
        setUploadState({
          file,
          progress: 100,
          status: "error",
          error: message,
        });
        onError(message);
        return;
      }

      resetAttachForm();
      await onRefresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to upload proof artwork.";
      setUploadState((current) =>
        current
          ? {
              ...current,
              status: "error",
              error: message,
            }
          : current
      );
      onError(message);
    } finally {
      onPendingChange(false);
    }
  }

  async function removeAttachment() {
    onError(null);
    onPendingChange(true);

    try {
      const response = await fetch(`/api/admin/jobs/${jobId}/proofs/${proof.id}/file`, {
        method: "DELETE",
      });

      const payload = await readAttachResponsePayload(response);

      if (!response.ok) {
        onError(
          mapAttachFailureMessage(
            payload,
            response,
            "Unable to remove proof file."
          )
        );
        return;
      }

      await onRefresh();
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Unable to remove proof file."
      );
    } finally {
      onPendingChange(false);
    }
  }

  useEffect(() => {
    if (!showAttach || !dropboxLinked) {
      return;
    }

    if (attachSource === "customer_artwork" && customerArtworkFiles.length === 0) {
      void loadCustomerArtworkFiles();
    }

    if (attachSource === "working_file" && workingFiles.length === 0) {
      void loadWorkingFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAttach, attachSource, dropboxLinked]);

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
              setAttachSource("customer_artwork");
            }}
          >
            {proofFile ? "Replace attachment" : "Attach source artwork"}
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
                onClick={() => void removeAttachment()}
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
            <Label>Source artwork</Label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["customer_artwork", "Customer Artwork"],
                  ["working_file", "Candid Working Files"],
                  ["upload", "Upload File"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={attachSource === value ? "default" : "outline"}
                  disabled={pending}
                  onClick={() => void selectAttachSource(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {attachSource === "customer_artwork" ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={`attach-customer-${proof.id}`}>01 Customer Artwork</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending || loadingFiles}
                  onClick={() => void loadCustomerArtworkFiles()}
                >
                  Refresh
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Lists the current files in the job&apos;s Customer Artwork Dropbox folder,
                including manually copied files and customer portal uploads.
              </p>
              {!dropboxLinked ? (
                <p className="text-sm text-muted-foreground">
                  Link a Dropbox folder to this job before selecting customer artwork.
                </p>
              ) : customerArtworkFiles.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {loadingFiles
                    ? "Loading customer artwork files…"
                    : "No files found in 01 Customer Artwork yet."}
                </p>
              ) : (
                <select
                  id={`attach-customer-${proof.id}`}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={selectedCustomerPath}
                  onChange={(event) => setSelectedCustomerPath(event.target.value)}
                >
                  <option value="">Select a file</option>
                  {customerArtworkFiles.map((file) => {
                    const compatibility = proofGenerationCompatibilityLabel(file.name);
                    const blocked =
                      isProofSourceDiscoveryBlockedExtension(file.name) ||
                      !isProofSourceAttachExtension(file.name);

                    return (
                      <option
                        key={file.path}
                        value={blocked ? "" : file.path}
                        disabled={blocked}
                      >
                        {file.name}
                        {file.portalUploaded ? " · Portal upload" : ""}
                        {compatibility ? ` · ${compatibility}` : ""}
                        {file.size > 0 ? ` (${formatFileSize(file.size)})` : ""}
                      </option>
                    );
                  })}
                </select>
              )}
            </div>
          ) : null}

          {attachSource === "working_file" ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={`attach-working-${proof.id}`}>02 Working Files</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending || loadingFiles}
                  onClick={() => void loadWorkingFiles()}
                >
                  Refresh
                </Button>
              </div>
              {!dropboxLinked ? (
                <p className="text-sm text-muted-foreground">
                  Link a Dropbox folder to this job before selecting working files.
                </p>
              ) : workingFiles.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {loadingFiles
                    ? "Loading working files…"
                    : "No files found in 02 Working Files yet."}
                </p>
              ) : (
                <select
                  id={`attach-working-${proof.id}`}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={selectedWorkingPath}
                  onChange={(event) => setSelectedWorkingPath(event.target.value)}
                >
                  <option value="">Select a file</option>
                  {workingFiles.map((file) => {
                    const compatibility = proofGenerationCompatibilityLabel(file.name);
                    const blocked =
                      isProofSourceDiscoveryBlockedExtension(file.name) ||
                      !isProofSourceAttachExtension(file.name);

                    return (
                      <option
                        key={file.path}
                        value={blocked ? "" : file.path}
                        disabled={blocked}
                      >
                        {file.name}
                        {compatibility ? ` · ${compatibility}` : ""}
                        {file.size > 0 ? ` (${formatFileSize(file.size)})` : ""}
                      </option>
                    );
                  })}
                </select>
              )}
            </div>
          ) : null}

          {attachSource === "upload" ? (
            <div className="space-y-2">
              <Label htmlFor={`attach-upload-${proof.id}`}>Upload file to 02 Working Files</Label>
              <p className="text-xs text-muted-foreground">
                PDF, PDF-compatible AI, JPG, and PNG up to {formatMaxUploadLabel()}. Files
                upload in chunks to Dropbox and are then attached as proof source artwork.
                Large files may upload successfully even if automated proof analysis is
                currently limited to smaller artwork.
              </p>
              {!dropboxLinked ? (
                <p className="text-sm text-muted-foreground">
                  Link a Dropbox folder to this job before uploading proof files.
                </p>
              ) : (
                <>
                  <input
                    id={`attach-upload-${proof.id}`}
                    type="file"
                    accept={PROOF_SOURCE_UPLOAD_ACCEPT}
                    className="block w-full text-sm"
                    disabled={pending}
                    onChange={(event) => {
                      const nextFile = event.target.files?.[0] ?? null;
                      setUploadFile(nextFile);
                      setUploadState(null);
                      onError(null);

                      if (nextFile && !isProofSourceAttachExtension(nextFile.name)) {
                        onError(proofSourceAttachExtensionError(nextFile.name));
                      }
                    }}
                  />
                  {uploadState ? (
                    <div className="space-y-1 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
                      <p>
                        {uploadState.file.name} · {Math.round(uploadState.progress)}%
                      </p>
                      {uploadState.status === "processing" ? (
                        <p className="text-muted-foreground">Finishing upload and attaching…</p>
                      ) : null}
                      {uploadState.error ? (
                        <p className="text-red-700">{uploadState.error}</p>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending || loadingFiles}
              onClick={() => void attachFromSource()}
            >
              Save attachment
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending && uploadState?.status === "uploading"}
              onClick={() => {
                uploadAbortRef.current = true;
                resetAttachForm();
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
