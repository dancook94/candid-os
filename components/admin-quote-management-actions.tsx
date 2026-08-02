"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { buildPermanentDeleteConfirmationHint } from "@/lib/admin-quote-actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatGbp } from "@/lib/format-currency";

type AdminQuoteManagementActionsProps = {
  quoteId: string;
  quoteNumber: number;
  quoteStatus: string;
  versionNumber: number;
  companyName: string;
  total: number;
  canRespondOnBehalf: boolean;
  hidePermanentDelete?: boolean;
};

type ConfirmAction = "accept" | "decline" | "delete" | null;

export function AdminQuoteManagementActions({
  quoteId,
  quoteNumber,
  quoteStatus,
  versionNumber,
  companyName,
  total,
  canRespondOnBehalf,
  hidePermanentDelete = false,
}: AdminQuoteManagementActionsProps) {
  const router = useRouter();
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const deleteHint = buildPermanentDeleteConfirmationHint(
    quoteNumber,
    quoteStatus
  );
  const deleteMatches = deleteConfirmation.trim() === deleteHint;

  async function handleDecisionConfirm() {
    if (!confirmAction || confirmAction === "delete") {
      return;
    }

    setError("");
    setIsSubmitting(true);

    const endpoint =
      confirmAction === "accept"
        ? `/api/admin/quotes/${quoteId}/accept`
        : `/api/admin/quotes/${quoteId}/decline`;

    try {
      const response = await fetch(endpoint, { method: "POST" });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Unable to update this quotation.");
        setIsSubmitting(false);
        return;
      }

      setConfirmAction(null);
      setIsSubmitting(false);
      router.refresh();
    } catch {
      setError("Unable to update this quotation. Please try again.");
      setIsSubmitting(false);
    }
  }

  async function handlePermanentDelete() {
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/quotes/${quoteId}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: deleteConfirmation.trim() }),
      });
      const payload = (await response.json()) as {
        error?: string;
        storageWarnings?: string[];
      };

      if (!response.ok) {
        const storageDetail =
          payload.storageWarnings && payload.storageWarnings.length > 0
            ? ` ${payload.storageWarnings.join(" ")}`
            : "";
        setError((payload.error ?? "Unable to delete this quotation.") + storageDetail);
        setIsSubmitting(false);
        return;
      }

      router.push("/admin/quotes");
      router.refresh();
    } catch {
      setError("Unable to delete this quotation. Please try again.");
      setIsSubmitting(false);
    }
  }

  const decisionDialogCopy =
    confirmAction === "accept"
      ? {
          title: "Accept on behalf of customer",
          description: `Accept quotation Q-${quoteNumber}, Version ${versionNumber}, for ${companyName}, totalling ${formatGbp(total)}?`,
          confirmLabel: "Confirm acceptance",
        }
      : confirmAction === "decline"
        ? {
            title: "Decline on behalf of customer",
            description: `Decline quotation Q-${quoteNumber}, Version ${versionNumber}, for ${companyName}, totalling ${formatGbp(total)}? The customer will see this quote as declined.`,
            confirmLabel: "Confirm decline",
          }
        : null;

  return (
    <>
      {canRespondOnBehalf ? (
        <Card className="portal-surface mb-6">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold">
              Customer decision
            </CardTitle>
            <CardDescription>
              Record the customer&apos;s decision on the current sent version.
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-wrap gap-3 pt-6">
            <Button
              type="button"
              disabled={isSubmitting}
              onClick={() => setConfirmAction("accept")}
            >
              Accept on behalf of customer
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => setConfirmAction("decline")}
            >
              Decline on behalf of customer
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {hidePermanentDelete ? null : (
      <Card className="portal-surface mb-6 border-red-200">
        <CardHeader className="border-b border-red-200/70">
          <CardTitle className="text-lg font-semibold text-red-900">
            Danger zone
          </CardTitle>
          <CardDescription>
            Permanently remove this quote, all versions, line items and stored
            images. This cannot be undone.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 pt-6">
          <p className="text-sm text-muted-foreground">
            This permanently removes the quote, all versions, line items and
            associated images. This cannot be undone.
          </p>

          <div className="space-y-2">
            <label
              htmlFor="delete-confirmation"
              className="text-sm font-medium text-foreground"
            >
              Type{" "}
              <span className="font-mono">{deleteHint}</span> to confirm
            </label>
            <Input
              id="delete-confirmation"
              value={deleteConfirmation}
              disabled={isSubmitting}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              placeholder={deleteHint}
              autoComplete="off"
            />
          </div>

          <Button
            type="button"
            variant="destructive"
            disabled={isSubmitting || !deleteMatches}
            onClick={() => setConfirmAction("delete")}
          >
            Permanently delete quote
          </Button>
        </CardContent>
      </Card>
      )}

      {error ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {confirmAction && confirmAction !== "delete" && decisionDialogCopy ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close dialog"
            className="absolute inset-0 bg-neutral-950/40"
            onClick={() => {
              if (!isSubmitting) {
                setConfirmAction(null);
              }
            }}
          />

          <Card className="relative z-10 w-full max-w-md rounded-2xl border-neutral-200 shadow-lg ring-0">
            <CardHeader className="border-b border-neutral-200">
              <CardTitle className="text-lg font-semibold text-neutral-950">
                {decisionDialogCopy.title}
              </CardTitle>
              <CardDescription>{decisionDialogCopy.description}</CardDescription>
            </CardHeader>

            <CardContent className="flex justify-end gap-2 pt-6">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => setConfirmAction(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant={confirmAction === "decline" ? "destructive" : "default"}
                disabled={isSubmitting}
                onClick={handleDecisionConfirm}
              >
                {isSubmitting ? "Processing..." : decisionDialogCopy.confirmLabel}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {confirmAction === "delete" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close dialog"
            className="absolute inset-0 bg-neutral-950/40"
            onClick={() => {
              if (!isSubmitting) {
                setConfirmAction(null);
              }
            }}
          />

          <Card className="relative z-10 w-full max-w-md rounded-2xl border-red-200 shadow-lg ring-0">
            <CardHeader className="border-b border-red-200">
              <CardTitle className="text-lg font-semibold text-red-900">
                Permanently delete quote
              </CardTitle>
              <CardDescription>
                Delete Q-{quoteNumber} and all related versions, line items and
                images? This cannot be undone.
              </CardDescription>
            </CardHeader>

            <CardContent className="flex justify-end gap-2 pt-6">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => setConfirmAction(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={isSubmitting || !deleteMatches}
                onClick={handlePermanentDelete}
              >
                {isSubmitting ? "Deleting..." : "Delete permanently"}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
