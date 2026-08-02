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
import { formatGbp } from "@/lib/format-currency";

type CustomerQuoteActionsProps = {
  quoteId: string;
  quoteNumber: number;
  versionNumber: number;
  total: number;
};

type ConfirmAction = "accept" | "decline" | null;

export function CustomerQuoteActions({
  quoteId,
  quoteNumber,
  versionNumber,
  total,
}: CustomerQuoteActionsProps) {
  const router = useRouter();
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    if (!confirmAction) {
      return;
    }

    setError("");
    setIsSubmitting(true);

    const endpoint =
      confirmAction === "accept"
        ? `/api/quotes/${quoteId}/accept`
        : `/api/quotes/${quoteId}/decline`;

    try {
      const response = await fetch(endpoint, { method: "POST" });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Unable to update this quotation.");
        setIsSubmitting(false);

        if (response.status === 409) {
          setConfirmAction(null);
          router.refresh();
        }

        return;
      }

      setConfirmAction(null);
      router.refresh();
    } catch {
      setError("Unable to update this quotation. Please try again.");
      setIsSubmitting(false);
    }
  }

  const confirmCopy =
    confirmAction === "accept"
      ? `Accept quotation Q-${quoteNumber}, Version ${versionNumber}, for ${formatGbp(total)}?`
      : confirmAction === "decline"
        ? "Decline this quotation? Candid Creative will be notified."
        : "";

  return (
    <>
      <section
        aria-label="Quote decision"
        className="mb-8 rounded-2xl border border-neutral-200/80 bg-white p-6 shadow-sm"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-neutral-950">
              Your decision
            </h2>
            <p className="mt-1 text-sm text-neutral-600">
              Review the quotation below, then accept or decline the current
              version.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={isSubmitting}
              onClick={() => setConfirmAction("accept")}
            >
              Accept quote
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => setConfirmAction("decline")}
            >
              Decline quote
            </Button>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
      </section>

      {confirmAction ? (
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
                {confirmAction === "accept" ? "Accept quote" : "Decline quote"}
              </CardTitle>
              <CardDescription>{confirmCopy}</CardDescription>
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
                onClick={handleConfirm}
              >
                {isSubmitting
                  ? "Processing..."
                  : confirmAction === "accept"
                    ? "Confirm acceptance"
                    : "Confirm decline"}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
