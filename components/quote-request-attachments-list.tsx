"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatFileSize,
  QUOTE_REQUEST_FILES_BUCKET,
  type QuoteRequestAttachmentRecord,
} from "@/lib/quote-request-attachments";
import { createClient } from "@/lib/supabase/client";

type QuoteRequestAttachmentsListProps = {
  attachments: QuoteRequestAttachmentRecord[];
};

function formatUploadDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function QuoteRequestAttachmentsList({
  attachments,
}: QuoteRequestAttachmentsListProps) {
  const supabase = createClient();
  const [error, setError] = useState("");
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);

  async function handleDownload(attachment: QuoteRequestAttachmentRecord) {
    setError("");
    setDownloadingPath(attachment.storage_path);

    const { data, error: signedUrlError } = await supabase.storage
      .from(QUOTE_REQUEST_FILES_BUCKET)
      .createSignedUrl(attachment.storage_path, 60);

    setDownloadingPath(null);

    if (signedUrlError || !data?.signedUrl) {
      setError(signedUrlError?.message ?? "Unable to generate download link.");
      return;
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <Card className="mt-6 rounded-2xl border-neutral-200 shadow-sm ring-0">
      <CardHeader className="border-b border-neutral-200">
        <CardTitle className="text-lg font-semibold text-neutral-950">
          Attachments
        </CardTitle>
      </CardHeader>

      <CardContent className="pt-6">
        {attachments.length === 0 ? (
          <p className="text-sm text-neutral-500">No files uploaded yet.</p>
        ) : (
          <ul className="space-y-2">
            {attachments.map((attachment) => (
              <li
                key={attachment.id}
                className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50/50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-950">
                    {attachment.file_name}
                  </p>
                  <p className="text-xs text-neutral-500">
                    Uploaded {formatUploadDate(attachment.created_at)} ·{" "}
                    {formatFileSize(attachment.file_size)}
                  </p>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={downloadingPath === attachment.storage_path}
                  onClick={() => handleDownload(attachment)}
                >
                  {downloadingPath === attachment.storage_path
                    ? "Preparing..."
                    : "Download"}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-800">Download failed</p>
            <p className="mt-1 text-sm text-red-700">{error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
