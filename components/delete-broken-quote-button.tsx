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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleDeleteBrokenQuote() {
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/quotes/${quoteId}/delete-broken`, {
        method: "POST",
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
        onClick={() => setConfirmOpen(true)}
      >
        Delete broken quote
      </Button>

      {error ? (
        <p className="mt-3 text-sm text-red-700">{error}</p>
      ) : null}

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close dialog"
            className="absolute inset-0 bg-neutral-950/40"
            onClick={() => {
              if (!isSubmitting) {
                setConfirmOpen(false);
              }
            }}
          />

          <Card className="relative z-10 w-full max-w-md rounded-2xl border-red-200 shadow-lg ring-0">
            <CardHeader className="border-b border-red-200">
              <CardTitle className="text-lg font-semibold text-red-900">
                Delete broken quote
              </CardTitle>
              <CardDescription>
                Remove the orphaned Q-{quoteNumber} record? This quote has no
                versions and cannot be edited. Any linked CRM activity will be
                preserved.
              </CardDescription>
            </CardHeader>

            <CardContent className="flex justify-end gap-2 pt-6">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={isSubmitting}
                onClick={handleDeleteBrokenQuote}
              >
                {isSubmitting ? "Deleting..." : "Delete broken quote"}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
