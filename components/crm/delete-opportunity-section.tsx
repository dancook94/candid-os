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

type DeleteOpportunitySectionProps = {
  opportunityId: string;
  opportunityTitle: string;
  companyName: string;
  canDelete: boolean;
  blockReason: string | null;
};

export function DeleteOpportunitySection({
  opportunityId,
  opportunityTitle,
  companyName,
  canDelete,
  blockReason,
}: DeleteOpportunitySectionProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmationTitle, setConfirmationTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handlePermanentDelete() {
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/opportunities/${opportunityId}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationTitle: confirmationTitle.trim() }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Unable to delete this opportunity.");
        setIsSubmitting(false);
        return;
      }

      router.push("/admin/opportunities");
      router.refresh();
    } catch {
      setError("Unable to delete this opportunity. Please try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Card className="portal-surface mt-8 border-red-200">
        <CardHeader className="border-b border-red-200/70">
          <CardTitle className="text-lg font-semibold text-red-900">
            Danger zone
          </CardTitle>
          <CardDescription>
            Permanently delete this opportunity and remove its CRM links. This
            cannot be undone.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 pt-6">
          {blockReason ? (
            <p className="text-sm text-muted-foreground">{blockReason}</p>
          ) : null}

          <Button
            type="button"
            variant="destructive"
            disabled={!canDelete || isSubmitting}
            onClick={() => {
              setError("");
              setConfirmationTitle("");
              setConfirmOpen(true);
            }}
          >
            Permanently delete opportunity
          </Button>
        </CardContent>
      </Card>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <ConfirmTextMatchDialog
        open={confirmOpen}
        title="Permanently delete opportunity"
        description={
          <>
            Delete <span className="font-medium">{opportunityTitle}</span> for{" "}
            <span className="font-medium">{companyName}</span>? This action
            cannot be undone.
          </>
        }
        confirmationLabel={
          <>
            Type <span className="font-mono">{opportunityTitle}</span> to confirm
          </>
        }
        confirmationValue={confirmationTitle}
        confirmText={opportunityTitle}
        onConfirmationChange={setConfirmationTitle}
        confirmLabel="Delete permanently"
        confirmingLabel="Deleting..."
        isSubmitting={isSubmitting}
        onCancel={() => {
          if (!isSubmitting) {
            setConfirmOpen(false);
          }
        }}
        onConfirm={handlePermanentDelete}
        destructive
      />
    </>
  );
}
