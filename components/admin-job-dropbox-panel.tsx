"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type AdminJobDropboxPanelProps = {
  jobId: string;
  dropboxSetupStatus: string;
  dropboxConfigured: boolean;
};

export function AdminJobDropboxPanel({
  jobId,
  dropboxSetupStatus,
  dropboxConfigured,
}: AdminJobDropboxPanelProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (dropboxSetupStatus === "ready") {
    return null;
  }

  async function handleRetryDropboxSetup() {
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/jobs/${jobId}/retry-dropbox`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        dropboxReady?: boolean;
      };

      if (!response.ok) {
        setError(payload.error ?? "Unable to set up Dropbox folders.");
        setIsSubmitting(false);
        return;
      }

      setIsSubmitting(false);
      router.refresh();
    } catch {
      setError("Unable to set up Dropbox folders. Please try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="portal-surface mb-6 overflow-hidden">
      <CardHeader className="border-b border-border">
        <CardTitle className="text-lg font-semibold">Dropbox setup</CardTitle>
        <CardDescription>
          Customer artwork uploads require the job folder structure in Dropbox.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        <p className="text-sm font-medium text-amber-950">
          Dropbox setup is{" "}
          {dropboxSetupStatus === "failed" ? "failed" : "pending"} for this job.
        </p>

        {!dropboxConfigured ? (
          <p className="text-sm text-muted-foreground">
            Dropbox credentials are not configured on the server. Set{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">DROPBOX_APP_KEY</code>,{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">DROPBOX_APP_SECRET</code>,{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">DROPBOX_REFRESH_TOKEN</code>, and{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">DROPBOX_ROOT_FOLDER</code>.
          </p>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting}
            onClick={handleRetryDropboxSetup}
          >
            {isSubmitting ? "Setting up Dropbox..." : "Retry Dropbox setup"}
          </Button>
        )}

        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
