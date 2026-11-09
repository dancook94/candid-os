"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { LeaveStatusBadge } from "@/components/staff-leave/leave-status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LeaveRequestWithProfile } from "@/lib/staff-leave/queries";

function formatRange(request: LeaveRequestWithProfile) {
  if (request.start_date === request.end_date) {
    return request.start_date;
  }

  return `${request.start_date} → ${request.end_date}`;
}

export function AdminLeavePendingQueue({
  requests,
}: {
  requests: LeaveRequestWithProfile[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function decide(requestId: string, decision: "approved" | "rejected") {
    setBusyId(requestId);
    setError(null);

    const response = await fetch(`/api/admin/leave/requests/${requestId}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision,
        decisionNote: notes[requestId]?.trim() || null,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setBusyId(null);

    if (!response.ok) {
      setError(payload.error ?? "Could not save decision.");
      return;
    }

    router.refresh();
  }

  if (requests.length === 0) {
    return (
      <p className="px-6 py-5 text-sm text-muted-foreground">
        No pending holiday requests for this year.
      </p>
    );
  }

  return (
    <div className="divide-y divide-border">
      {error ? (
        <p className="px-6 py-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {requests.map((request) => (
        <article
          key={request.id}
          className="flex flex-col gap-4 px-6 py-5 lg:flex-row lg:items-start lg:justify-between"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-medium text-foreground">
              {(Array.isArray(request.profiles)
                ? request.profiles[0]?.full_name
                : request.profiles?.full_name) ?? "Team member"}
            </p>
            <p className="text-sm text-muted-foreground">
              {formatRange(request)} · {request.days_requested} day
              {request.days_requested === 1 ? "" : "s"} ({request.day_portion})
            </p>
            {request.employee_note ? (
              <p className="text-sm text-muted-foreground">{request.employee_note}</p>
            ) : null}
            <LeaveStatusBadge status={request.status} />
          </div>

          <div className="w-full max-w-sm space-y-3">
            <div className="space-y-2">
              <Label htmlFor={`note-${request.id}`}>Decision note (optional)</Label>
              <Input
                id={`note-${request.id}`}
                value={notes[request.id] ?? ""}
                onChange={(event) =>
                  setNotes((current) => ({
                    ...current,
                    [request.id]: event.target.value,
                  }))
                }
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busyId === request.id}
                onClick={() => decide(request.id, "approved")}
              >
                Approve
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busyId === request.id}
                onClick={() => decide(request.id, "rejected")}
              >
                Decline
              </Button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
