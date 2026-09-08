"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  PROBLEM_REPORT_STATUSES,
  formatProblemReportStatusLabel,
  type ProblemReportRecord,
  type ProblemReportStatus,
} from "@/lib/updates/types";

type ProblemReportAdminFormProps = {
  report: ProblemReportRecord;
};

export function ProblemReportAdminForm({ report }: ProblemReportAdminFormProps) {
  const router = useRouter();
  const [status, setStatus] = useState<ProblemReportStatus>(report.status);
  const [adminNotes, setAdminNotes] = useState(report.admin_notes ?? "");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/problem-reports/${report.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status,
          adminNotes,
        }),
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Unable to save report.");
        return;
      }

      setSuccess("Report updated successfully.");
      router.refresh();
    } catch {
      setError("Unable to save report.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const createUpdateHref = `/admin/updates/new?fromReport=${report.id}`;

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="report-status">Status</Label>
        <select
          id="report-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as ProblemReportStatus)}
          disabled={isSubmitting}
          className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-foreground/10 disabled:opacity-50"
        >
          {PROBLEM_REPORT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {formatProblemReportStatusLabel(value)}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="report-admin-notes">Admin notes</Label>
        <textarea
          id="report-admin-notes"
          value={adminNotes}
          onChange={(event) => setAdminNotes(event.target.value)}
          rows={5}
          disabled={isSubmitting}
          className="min-h-28 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-foreground/10 disabled:opacity-50"
        />
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Save changes"}
        </Button>

        {status === "fixed" ? (
          <Link href={createUpdateHref} className={buttonVariants({ variant: "outline" })}>
            Create update from this report
          </Link>
        ) : null}
      </div>
    </form>
  );
}
