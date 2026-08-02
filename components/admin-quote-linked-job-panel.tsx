"use client";

import Link from "next/link";
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

type AdminQuoteLinkedJobPanelProps = {
  quoteId: string;
  quoteStatus: string;
  linkedJobId: string | null;
  linkedJobReference: string | null;
  schemaMissing: boolean;
};

export function AdminQuoteLinkedJobPanel({
  quoteId,
  quoteStatus,
  linkedJobId,
  linkedJobReference,
  schemaMissing,
}: AdminQuoteLinkedJobPanelProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (quoteStatus !== "accepted") {
    return null;
  }

  async function handleEnsureJob() {
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/quotes/${quoteId}/ensure-job`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        jobId?: string | null;
        schemaMissing?: boolean;
      };

      if (!response.ok) {
        setError(payload.error ?? "Unable to create job.");
        setIsSubmitting(false);
        return;
      }

      setIsSubmitting(false);
      router.refresh();
    } catch {
      setError("Unable to create job. Please try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="portal-surface mb-6 overflow-hidden">
      <CardHeader className="border-b border-border">
        <CardTitle className="text-lg font-semibold">Production job</CardTitle>
        <CardDescription>
          Customer-visible job created when this quote is accepted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        {linkedJobId ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">
              Linked job{" "}
              <span className="font-medium text-foreground">
                {linkedJobReference ?? linkedJobId}
              </span>
            </p>
            <Link href={`/admin/jobs/${linkedJobId}`}>
              <Button variant="outline" size="sm">
                View job
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium text-amber-950">
              This accepted quote has no job.
            </p>
            {schemaMissing ? (
              <p className="text-sm text-muted-foreground">
                The jobs table is not deployed in Supabase yet. Apply{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  supabase/migrations/20260802190000_jobs_foundation.sql
                </code>{" "}
                in the SQL editor, then create the missing job.
              </p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting || schemaMissing}
              onClick={handleEnsureJob}
            >
              {isSubmitting ? "Creating job..." : "Create missing job"}
            </Button>
          </div>
        )}

        {error ? (
          <p className="text-sm text-red-700">{error}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
