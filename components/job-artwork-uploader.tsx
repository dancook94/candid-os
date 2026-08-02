"use client";

import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JOB_ARTWORK_ACCEPT, getJobArtworkMaxBytes } from "@/lib/jobs/constants";
import { cn } from "@/lib/utils";
import { formatFileSize } from "@/lib/quote-request-attachments";

type JobArtworkUploaderProps = {
  jobId: string;
  enabled: boolean;
  disabledMessage?: string | null;
  replaceFileId?: string | null;
  onComplete?: () => void;
};

type UploadState = {
  file: File;
  note: string;
  progress: number;
  status: "idle" | "uploading" | "processing" | "complete" | "error" | "cancelled";
  error: string | null;
  fileId: string | null;
};

export function JobArtworkUploader({
  jobId,
  enabled,
  disabledMessage,
  replaceFileId,
  onComplete,
}: JobArtworkUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);
  const [note, setNote] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [upload, setUpload] = useState<UploadState | null>(null);

  const heading = replaceFileId ? "Upload replacement artwork" : "Upload artwork";
  const supportingText = replaceFileId
    ? "Upload a replacement file. The previous version will be kept for reference."
    : "Upload your print-ready artwork for this job. Large files may take several minutes.";

  const canInteract =
    enabled &&
    upload?.status !== "uploading" &&
    upload?.status !== "processing";

  const progressLabel = useMemo(() => {
    if (!upload) {
      return null;
    }

    if (upload.status === "processing") {
      return "Finalising upload…";
    }

    if (upload.status === "complete") {
      return "Upload complete";
    }

    if (upload.status === "error") {
      return upload.error ?? "Upload failed";
    }

    return `${Math.round(upload.progress)}% uploaded`;
  }, [upload]);

  async function startUpload(file: File, note: string) {
    abortRef.current = false;
    setUpload({
      file,
      note,
      progress: 0,
      status: "uploading",
      error: null,
      fileId: null,
    });

    try {
      const sessionResponse = await fetch(
        `/api/customer/jobs/${jobId}/files/upload/session`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type || null,
            fileSizeBytes: file.size,
            customerNotes: note.trim() || null,
            supersedesFileId: replaceFileId,
          }),
        }
      );

      const sessionPayload = (await sessionResponse.json()) as {
        error?: string;
        fileId?: string;
        chunkSizeBytes?: number;
        totalBytes?: number;
      };

      if (!sessionResponse.ok || !sessionPayload.fileId) {
        throw new Error(sessionPayload.error ?? "Unable to start upload.");
      }

      const chunkSize = sessionPayload.chunkSizeBytes ?? 4 * 1024 * 1024;
      const fileId = sessionPayload.fileId;
      let offset = 0;

      setUpload((current) =>
        current ? { ...current, fileId } : current
      );

      while (offset < file.size) {
        if (abortRef.current) {
          await fetch(`/api/customer/jobs/${jobId}/files/${fileId}`, {
            method: "DELETE",
          });
          setUpload((current) =>
            current ? { ...current, status: "cancelled", error: null } : current
          );
          return;
        }

        const chunk = file.slice(offset, offset + chunkSize);
        const formData = new FormData();
        formData.append("chunk", chunk, file.name);

        const chunkResponse = await fetch(
          `/api/customer/jobs/${jobId}/files/${fileId}`,
          {
            method: "POST",
            body: formData,
          }
        );

        const chunkPayload = (await chunkResponse.json()) as {
          error?: string;
          uploadedBytes?: number;
          totalBytes?: number;
        };

        if (!chunkResponse.ok) {
          throw new Error(chunkPayload.error ?? "Upload chunk failed.");
        }

        offset = chunkPayload.uploadedBytes ?? offset + chunk.size;
        const totalBytes = chunkPayload.totalBytes ?? file.size;
        setUpload((current) =>
          current
            ? {
                ...current,
                progress: Math.min(100, (offset / totalBytes) * 100),
              }
            : current
        );
      }

      setUpload((current) =>
        current ? { ...current, status: "processing", progress: 100 } : current
      );

      const finishResponse = await fetch(
        `/api/customer/jobs/${jobId}/files/${fileId}`,
        { method: "PUT" }
      );

      const finishPayload = (await finishResponse.json()) as { error?: string };

      if (!finishResponse.ok) {
        throw new Error(finishPayload.error ?? "Unable to finalise upload.");
      }

      setUpload((current) =>
        current ? { ...current, status: "complete", progress: 100 } : current
      );
      setNote("");
      onComplete?.();
    } catch (error) {
      setUpload((current) =>
        current
          ? {
              ...current,
              status: "error",
              error:
                error instanceof Error ? error.message : "Upload failed.",
            }
          : current
      );
    }
  }

  function handleFiles(selectedFiles: FileList | null) {
    if (!canInteract || !selectedFiles?.[0]) {
      return;
    }

    setSelectedFile(selectedFiles[0]);
  }

  function handleStartUpload() {
    if (!canInteract || !selectedFile) {
      return;
    }

    void startUpload(selectedFile, note);
    setSelectedFile(null);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-neutral-950">{heading}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{supportingText}</p>
      </div>

      {!enabled ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
          {disabledMessage ?? "Dropbox integration is not configured."}
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="artwork-note">Upload note (optional)</Label>
            <Input
              id="artwork-note"
              value={note}
              disabled={!canInteract}
              placeholder="Final artwork, fonts outlined, etc."
              onChange={(event) => setNote(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Add your note before starting the upload.
            </p>
          </div>

          <div
            className={cn(
              "rounded-xl border border-dashed px-6 py-10 text-center transition",
              dragActive
                ? "border-neutral-950 bg-muted/40"
                : "border-border bg-muted/10",
              !canInteract && "opacity-60"
            )}
            onDragEnter={(event) => {
              event.preventDefault();
              if (canInteract) {
                setDragActive(true);
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              if (canInteract) {
                setDragActive(true);
              }
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              handleFiles(event.dataTransfer.files);
            }}
          >
            <p className="text-sm font-medium text-neutral-950">
              Drag and drop artwork here
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              PDF, AI, EPS, SVG, PSD, TIFF, JPG, PNG, or ZIP · up to{" "}
              {formatFileSize(getJobArtworkMaxBytes())}
            </p>
            <div className="mt-4 flex justify-center gap-3">
              <Button
                type="button"
                disabled={!canInteract}
                onClick={() => inputRef.current?.click()}
              >
                Browse files
              </Button>
              {selectedFile ? (
                <Button
                  type="button"
                  disabled={!canInteract}
                  onClick={handleStartUpload}
                >
                  Upload artwork
                </Button>
              ) : null}
              {upload?.status === "uploading" || upload?.status === "processing" ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    abortRef.current = true;
                  }}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={JOB_ARTWORK_ACCEPT}
              className="hidden"
              onChange={(event) => handleFiles(event.target.files)}
            />
          </div>

          {selectedFile && !upload ? (
            <div className="rounded-xl border border-border bg-background px-4 py-4 text-sm">
              <p className="font-medium text-neutral-950">Selected file</p>
              <p className="mt-1 text-muted-foreground">
                {selectedFile.name} · {formatFileSize(selectedFile.size)}
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button type="button" disabled={!canInteract} onClick={handleStartUpload}>
                  Upload artwork
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!canInteract}
                  onClick={() => setSelectedFile(null)}
                >
                  Clear selection
                </Button>
              </div>
            </div>
          ) : null}

          {upload ? (
            <div className="rounded-xl border border-border bg-background px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium text-neutral-950">{upload.file.name}</p>
                  <p className="text-muted-foreground">
                    {formatFileSize(upload.file.size)}
                  </p>
                </div>
                <p className="text-muted-foreground">{progressLabel}</p>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-neutral-950 transition-all"
                  style={{ width: `${upload.progress}%` }}
                />
              </div>
              {upload.error ? (
                <p className="mt-3 text-sm text-red-600">{upload.error}</p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
