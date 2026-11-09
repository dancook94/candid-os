"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { LeaveRequestRow } from "@/lib/staff-leave/queries";

function formatRange(request: Pick<LeaveRequestRow, "start_date" | "end_date">) {
  if (request.start_date === request.end_date) {
    return request.start_date;
  }

  return `${request.start_date} → ${request.end_date}`;
}

export function LeaveCancelDialog({
  open,
  request,
  onClose,
  onConfirm,
  isSubmitting,
  onBehalfLabel,
  requiresReason = false,
}: {
  open: boolean;
  request: LeaveRequestRow | null;
  onClose: () => void;
  onConfirm: (cancellationNote: string | null) => void;
  isSubmitting: boolean;
  onBehalfLabel?: string | null;
  requiresReason?: boolean;
}) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setReason("");
    }
  }, [open, request?.id]);

  if (!open || !request) {
    return null;
  }

  const reasonReady = !requiresReason || reason.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-cancel-title"
      >
        <h2 id="leave-cancel-title" className="text-lg font-semibold">
          Cancel this holiday?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {formatRange(request)} · {request.days_requested} day
          {request.days_requested === 1 ? "" : "s"} ({request.day_portion}) will be
          removed from the calendar and the remaining allowance will update immediately.
          {request.status === "pending"
            ? " Pending requests do not require manager approval to cancel."
            : requiresReason
              ? " This leave has already started; provide a reason for the audit trail."
              : " Future approved leave can be cancelled without manager approval."}
        </p>
        {onBehalfLabel ? (
          <p className="mt-2 text-sm text-muted-foreground">
            You are cancelling leave for <strong>{onBehalfLabel}</strong>.
          </p>
        ) : null}

        {requiresReason ? (
          <div className="mt-4 space-y-2">
            <Label htmlFor="leave-cancel-reason">Cancellation reason</Label>
            <Textarea
              id="leave-cancel-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              required
              placeholder="Why is this historical or in-progress leave being cancelled?"
            />
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Keep leave
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => onConfirm(requiresReason ? reason.trim() : null)}
            disabled={isSubmitting || !reasonReady}
          >
            {isSubmitting ? "Cancelling…" : "Cancel holiday"}
          </Button>
        </div>
      </div>
    </div>
  );
}
