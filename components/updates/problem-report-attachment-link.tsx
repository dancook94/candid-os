"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

type ProblemReportAttachmentLinkProps = {
  reportId: string;
  fileName: string;
};

export function ProblemReportAttachmentLink({
  reportId,
  fileName,
}: ProblemReportAttachmentLinkProps) {
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleDownload() {
    setError("");
    setIsLoading(true);

    try {
      const response = await fetch(`/api/problem-reports/${reportId}/attachment`);
      const payload = (await response.json()) as {
        signedUrl?: string;
        error?: string;
      };

      if (!response.ok || !payload.signedUrl) {
        setError(payload.error ?? "Unable to open attachment.");
        return;
      }

      window.open(payload.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      setError("Unable to open attachment.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div>
      <Button type="button" variant="outline" disabled={isLoading} onClick={handleDownload}>
        {isLoading ? "Opening..." : fileName}
      </Button>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
