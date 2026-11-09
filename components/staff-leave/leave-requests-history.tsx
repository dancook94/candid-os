"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { LeaveCancelDialog } from "@/components/staff-leave/leave-cancel-dialog";
import { LeaveStatusBadge } from "@/components/staff-leave/leave-status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { evaluateLeaveCancellationEligibility } from "@/lib/staff-leave/cancel-policy";
import type { LeaveRequestRow, LeaveRequestWithProfile } from "@/lib/staff-leave/queries";
import { leaveRequestProfileName } from "@/lib/staff-leave/queries";

function formatRange(request: Pick<LeaveRequestRow, "start_date" | "end_date">) {
  if (request.start_date === request.end_date) {
    return request.start_date;
  }

  return `${request.start_date} → ${request.end_date}`;
}

function formatCancelledAt(iso: string | null) {
  if (!iso) {
    return null;
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(date);
}

type HistoryRequest = LeaveRequestRow | LeaveRequestWithProfile;

export function LeaveRequestsHistory({
  title,
  requests,
  emptyMessage,
  cancelApiBase,
  showEmployeeName = false,
  viewerProfileId,
  isApprovedAdmin,
  londonToday,
}: {
  title: string;
  requests: HistoryRequest[];
  emptyMessage: string;
  cancelApiBase: "/api/staff/leave/requests" | "/api/admin/leave/requests";
  showEmployeeName?: boolean;
  viewerProfileId: string;
  isApprovedAdmin: boolean;
  londonToday: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingCancel, setPendingCancel] = useState<LeaveRequestRow | null>(null);
  const [onBehalfName, setOnBehalfName] = useState<string | null>(null);
  const [requiresReason, setRequiresReason] = useState(false);

  const sorted = useMemo(
    () =>
      [...requests].sort((a, b) => {
        if (a.start_date === b.start_date) {
          return b.created_at.localeCompare(a.created_at);
        }
        return b.start_date.localeCompare(a.start_date);
      }),
    [requests]
  );

  async function confirmCancel(cancellationNote: string | null) {
    if (!pendingCancel) {
      return;
    }

    setBusyId(pendingCancel.id);
    setError(null);

    const response = await fetch(`${cancelApiBase}/${pendingCancel.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancellationNote }),
    });

    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setBusyId(null);

    if (!response.ok) {
      setError(payload.error ?? "Could not cancel leave.");
      return;
    }

    setPendingCancel(null);
    setOnBehalfName(null);
    setRequiresReason(false);
    router.refresh();
  }

  function openCancelDialog(request: HistoryRequest, eligibility: { requiresReason: boolean }) {
    const row = request as LeaveRequestRow;
    setPendingCancel(row);
    setRequiresReason(eligibility.requiresReason);
    if (showEmployeeName && "profiles" in request) {
      setOnBehalfName(leaveRequestProfileName(request.profiles));
    } else {
      setOnBehalfName(null);
    }
  }

  return (
    <>
      <Card className="portal-surface overflow-hidden rounded-2xl shadow-sm ring-0">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-lg font-semibold">{title}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <p className="px-6 py-3 text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          {sorted.length === 0 ? (
            <p className="px-6 py-5 text-sm text-muted-foreground">{emptyMessage}</p>
          ) : (
            <div className="divide-y divide-border">
              {sorted.map((request) => {
                const employeeName =
                  showEmployeeName && "profiles" in request
                    ? leaveRequestProfileName(request.profiles)
                    : null;

                const eligibility = evaluateLeaveCancellationEligibility({
                  status: request.status,
                  startDate: request.start_date,
                  actorProfileId: viewerProfileId,
                  ownerProfileId: request.profile_id,
                  isApprovedAdmin,
                  londonToday,
                });

                return (
                  <article
                    key={request.id}
                    className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      {employeeName ? (
                        <p className="text-sm font-medium text-foreground">{employeeName}</p>
                      ) : null}
                      <p className="text-sm font-medium text-foreground">
                        {request.leave_kind === "additional_paid" ? "Additional paid · " : null}
                        {formatRange(request)} · {request.days_requested} day
                        {request.days_requested === 1 ? "" : "s"} ({request.day_portion})
                      </p>
                      {request.employee_note ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {request.employee_note}
                        </p>
                      ) : null}
                      {request.decision_note ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Approver note: {request.decision_note}
                        </p>
                      ) : null}
                      {request.status === "cancelled" && request.cancelled_at ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Cancelled {formatCancelledAt(request.cancelled_at)}
                        </p>
                      ) : null}
                      {request.status === "cancelled" && request.cancellation_reason ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Cancellation reason: {request.cancellation_reason}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <LeaveStatusBadge status={request.status} />
                      {eligibility.canCancel ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busyId === request.id}
                          onClick={() => openCancelDialog(request, eligibility)}
                        >
                          Cancel holiday
                        </Button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <LeaveCancelDialog
        open={pendingCancel !== null}
        request={pendingCancel}
        onClose={() => {
          if (busyId) return;
          setPendingCancel(null);
          setOnBehalfName(null);
          setRequiresReason(false);
        }}
        onConfirm={confirmCancel}
        isSubmitting={busyId !== null}
        onBehalfLabel={onBehalfName}
        requiresReason={requiresReason}
      />
    </>
  );
}
