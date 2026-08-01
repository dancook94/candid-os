"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

const REQUEST_STATUSES = [
  "submitted",
  "reviewing",
  "quoted",
  "cancelled",
] as const;

const DEADLINE_STATUSES = [
  "pending",
  "approved",
  "alternative_proposed",
  "declined",
] as const;

type AdminQuoteRequestActionsProps = {
  quoteRequestId: string;
  initialRequestStatus: string;
  initialDeadlineStatus: string;
};

function formatStatusLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function AdminQuoteRequestActions({
  quoteRequestId,
  initialRequestStatus,
  initialDeadlineStatus,
}: AdminQuoteRequestActionsProps) {
  const router = useRouter();
  const supabase = createClient();

  const [requestStatus, setRequestStatus] = useState(initialRequestStatus);
  const [deadlineStatus, setDeadlineStatus] = useState(initialDeadlineStatus);
  const [proposedDate, setProposedDate] = useState("");
  const [proposedTime, setProposedTime] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSave() {
    setError("");
    setSuccess("");
    setIsSaving(true);

    const { error: updateError } = await supabase
      .from("quote_requests")
      .update({
        request_status: requestStatus,
        deadline_status: deadlineStatus,
      })
      .eq("id", quoteRequestId);

    setIsSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess("Status updated successfully.");
    router.refresh();
  }

  return (
    <Card className="mt-6 rounded-2xl border-neutral-200 shadow-sm ring-0">
      <CardHeader className="border-b border-neutral-200">
        <CardTitle className="text-lg font-semibold text-neutral-950">
          Admin actions
        </CardTitle>
        <CardDescription>
          Update the request and deadline status for this quote request.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5 pt-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="request-status">Request status</Label>
            <select
              id="request-status"
              value={requestStatus}
              onChange={(event) => setRequestStatus(event.target.value)}
              disabled={isSaving}
              className="h-8 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm outline-none focus-visible:border-neutral-950 focus-visible:ring-3 focus-visible:ring-neutral-950/10 disabled:opacity-50"
            >
              {REQUEST_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {formatStatusLabel(status)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="deadline-status">Deadline status</Label>
            <select
              id="deadline-status"
              value={deadlineStatus}
              onChange={(event) => setDeadlineStatus(event.target.value)}
              disabled={isSaving}
              className="h-8 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm outline-none focus-visible:border-neutral-950 focus-visible:ring-3 focus-visible:ring-neutral-950/10 disabled:opacity-50"
            >
              {DEADLINE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {formatStatusLabel(status)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {deadlineStatus === "alternative_proposed" && (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50/50 p-4">
            <p className="text-sm font-medium text-neutral-950">
              Proposed alternative deadline
            </p>
            <p className="mt-1 text-sm text-neutral-500">
              These fields are for reference only and are not saved yet.
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="proposed-date">Proposed date</Label>
                <Input
                  id="proposed-date"
                  type="date"
                  value={proposedDate}
                  onChange={(event) => setProposedDate(event.target.value)}
                  disabled={isSaving}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="proposed-time">Proposed time</Label>
                <Input
                  id="proposed-time"
                  type="time"
                  value={proposedTime}
                  onChange={(event) => setProposedTime(event.target.value)}
                  disabled={isSaving}
                />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-800">Update failed</p>
            <p className="mt-1 text-sm text-red-700">{error}</p>
          </div>
        )}

        {success && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-medium text-emerald-800">{success}</p>
          </div>
        )}

        <div className="flex justify-end">
          <Button type="button" disabled={isSaving} onClick={handleSave}>
            {isSaving ? "Saving..." : "Save status"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
