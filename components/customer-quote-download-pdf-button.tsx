"use client";

import { Download } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type QuoteDownloadPdfButtonProps = {
  quoteId: string;
  downloadPath?: string;
  disabled?: boolean;
};

export function QuoteDownloadPdfButton({
  quoteId,
  downloadPath,
  disabled = false,
}: QuoteDownloadPdfButtonProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const pdfPath = downloadPath ?? `/api/quotes/${quoteId}/pdf`;

  async function handleDownload() {
    setIsDownloading(true);

    try {
      const response = await fetch(pdfPath);

      if (!response.ok) {
        throw new Error("Download failed");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition");
      const filenameMatch = disposition?.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? "quotation.pdf";
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = objectUrl;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.alert("Unable to download the PDF. Please try again.");
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="gap-2"
      onClick={handleDownload}
      disabled={disabled || isDownloading}
    >
      <Download className="h-4 w-4" aria-hidden />
      {isDownloading ? "Preparing PDF…" : "Download PDF"}
    </Button>
  );
}

/** @deprecated Use QuoteDownloadPdfButton */
export const CustomerQuoteDownloadPdfButton = QuoteDownloadPdfButton;
