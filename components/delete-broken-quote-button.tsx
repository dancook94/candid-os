"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmTextMatchDialog } from "@/components/crm/confirm-text-match-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type DeleteBrokenQuoteButtonProps = {
  quoteId: string;
  quoteNumber: number;
};

export function DeleteBrokenQuoteButton({
  quoteId,
  quoteNumber,
}: DeleteBrokenQuoteButtonProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleDeleteBrokenQuote() {
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/quotes/${quoteId}/delete-broken`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: confirmationText.trim() }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Unable to delete this broken quote.");
        setIsSubmitting(false);
        return;
      }

      router.push("/admin/quotes");
      router.refresh();
    } catch {
      setError("Unable to delete this broken quote. Please try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        disabled={isSubmitting}
        onClick={() => {
          setError("");
          setConfirmationText("");
          setConfirmOpen(true);
        }}
      >
        Delete broken quote
      </Button>

      {error ? (
        <p className="mt-3 text-sm text-red-700">{error}</p>
      ) : null}

      <ConfirmTextMatchDialog
        open={confirmOpen}
        title="Delete broken quote"
        description={
          <>
            Remove the orphaned Q-{quoteNumber} record? This quote has no
            versions and cannot be edited. Any linked CRM activity will be
            preserved. This cannot be undone.
          </>
        }
        confirmationValue={confirmationText}
        onConfirmationChange={setConfirmationText}
        confirmLabel="Delete broken quote"
        confirmingLabel="Deleting..."
        isSubmitting={isSubmitting}
        onCancel={() => {
          if (!isSubmitting) {
            setConfirmOpen(false);
          }
        }}
        onConfirm={handleDeleteBrokenQuote}
        destructive
      />
    </>
  );
}
