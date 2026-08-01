"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { QuoteRequestFilePicker } from "@/components/quote-request-file-picker";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { uploadQuoteRequestAttachments } from "@/lib/quote-request-attachments";
import { createClient } from "@/lib/supabase/client";

type QuoteRequestAttachmentUploadProps = {
  quoteRequestId: string;
  companyId: string;
  uploadedBy: string;
};

export function QuoteRequestAttachmentUpload({
  quoteRequestId,
  companyId,
  uploadedBy,
}: QuoteRequestAttachmentUploadProps) {
  const router = useRouter();
  const supabase = createClient();

  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const [validationError, setValidationError] = useState("");

  async function handleUpload() {
    setError("");
    setValidationError("");

    if (files.length === 0) {
      setValidationError("Select at least one file to upload.");
      return;
    }

    setIsUploading(true);

    try {
      await uploadQuoteRequestAttachments(supabase, {
        files,
        companyId,
        quoteRequestId,
        uploadedBy,
      });

      setFiles([]);
      router.refresh();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Unable to upload files."
      );
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <Card className="mt-6 rounded-2xl border-neutral-200 shadow-sm ring-0">
      <CardHeader className="border-b border-neutral-200">
        <CardTitle className="text-lg font-semibold text-neutral-950">
          Add attachments
        </CardTitle>
        <CardDescription>
          Upload additional files while this request is still editable.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 pt-6">
        <QuoteRequestFilePicker
          files={files}
          onFilesChange={setFiles}
          disabled={isUploading}
          onValidationError={setValidationError}
        />

        {validationError && (
          <p className="text-sm text-red-600">{validationError}</p>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-800">Upload failed</p>
            <p className="mt-1 text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="flex justify-end">
          <Button
            type="button"
            disabled={isUploading || files.length === 0}
            onClick={handleUpload}
          >
            {isUploading ? "Uploading..." : "Upload files"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
