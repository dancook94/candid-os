"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatFileSize } from "@/lib/quote-request-attachments";

export type WebsiteArtworkListItem = {
  id: string;
  originalFileName: string;
  fileSizeBytes: number | null;
  mimeType: string | null;
  uploadStatus: "pending" | "uploaded" | "failed";
  createdAt: string;
};

const STATUS_LABELS: Record<WebsiteArtworkListItem["uploadStatus"], string> = {
  pending: "Pending",
  uploaded: "Uploaded",
  failed: "Failed",
};

function formatUploadDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function WebsiteEnquiryArtwork({
  quoteRequestId,
  artworkPending,
  files,
  warning,
}: {
  quoteRequestId: string;
  artworkPending: boolean;
  files: WebsiteArtworkListItem[];
  warning: string | null;
}) {
  const [error, setError] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const uploadedCount = files.filter((file) => file.uploadStatus === "uploaded").length;

  async function openFile(fileId: string) {
    setError("");
    setOpeningId(fileId);

    try {
      const response = await fetch(
        `/api/admin/quote-requests/${quoteRequestId}/artwork/${fileId}`,
        { headers: { Accept: "application/json" } }
      );
      const payload = (await response.json()) as { error?: string; url?: string };

      if (!response.ok || !payload.url) {
        setError(payload.error ?? "The artwork could not be opened.");
        return;
      }

      window.open(payload.url, "_blank", "noopener,noreferrer");
    } catch {
      setError("The artwork could not be opened.");
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <Card className="mt-6 rounded-2xl border-neutral-200 shadow-sm ring-0">
      <CardHeader className="border-b border-neutral-200">
        <CardTitle className="text-lg font-semibold text-neutral-950">
          Website artwork
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        {warning ? <p className="mb-3 text-sm text-amber-800">{warning}</p> : null}
        {files.length === 0 ? (
          <p className="text-sm text-neutral-500">
            {artworkPending
              ? "No artwork files yet. The customer said artwork will follow."
              : "No artwork files yet."}
          </p>
        ) : (
          <ul className="space-y-2">
            {files.map((file) => (
              <li
                key={file.id}
                className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50/50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-950">
                    {file.originalFileName}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {STATUS_LABELS[file.uploadStatus]} ·{" "}
                    {file.uploadStatus === "uploaded" ? "Uploaded" : "Added"}{" "}
                    {formatUploadDate(file.createdAt)} ·{" "}
                    {file.fileSizeBytes === null ? "Unknown size" : formatFileSize(file.fileSizeBytes)}
                    {" · "}
                    {file.mimeType ?? "Unknown type"}
                  </p>
                </div>
                {file.uploadStatus === "uploaded" ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={openingId === file.id}
                    onClick={() => openFile(file.id)}
                  >
                    {openingId === file.id ? "Opening..." : "Open"}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {artworkPending && uploadedCount === 0 && files.length > 0 ? (
          <p className="mt-3 text-sm text-neutral-500">
            The customer said artwork will follow.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
