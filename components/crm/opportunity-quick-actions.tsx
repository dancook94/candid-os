"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { LostReasonDialog } from "@/components/crm/lost-reason-dialog";
import { StageConfirmDialog } from "@/components/crm/stage-confirm-dialog";
import { Button } from "@/components/ui/button";
import type { OpportunityStage } from "@/lib/crm/types";

type OpportunityQuickActionsProps = {
  opportunityId: string;
  currentStage: OpportunityStage;
};

export function OpportunityQuickActions({
  opportunityId,
  currentStage,
}: OpportunityQuickActionsProps) {
  const router = useRouter();
  const [showLostDialog, setShowLostDialog] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingStage, setPendingStage] = useState<OpportunityStage | null>(
    null
  );
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState("");

  async function changeStage(
    newStage: OpportunityStage,
    options?: { lostReason?: string; confirmed?: boolean }
  ) {
    setIsUpdating(true);
    setError("");

    try {
      const response = await fetch(
        `/api/crm/opportunities/${opportunityId}/stage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stage: newStage,
            previousStage: currentStage,
            lostReason: options?.lostReason ?? null,
            confirmed: options?.confirmed ?? false,
          }),
        }
      );

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update stage.");
      }

      router.refresh();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Unable to update stage."
      );
    } finally {
      setIsUpdating(false);
      setShowLostDialog(false);
      setShowConfirm(false);
      setPendingStage(null);
    }
  }

  function requestStage(newStage: OpportunityStage) {
    if (newStage === "lost") {
      setShowLostDialog(true);
      return;
    }

    if (
      newStage === "won" ||
      currentStage === "won" ||
      currentStage === "lost"
    ) {
      setPendingStage(newStage);
      setShowConfirm(true);
      return;
    }

    void changeStage(newStage);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {currentStage !== "won" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isUpdating}
          onClick={() => requestStage("won")}
        >
          Mark won
        </Button>
      ) : null}
      {currentStage !== "lost" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isUpdating}
          onClick={() => requestStage("lost")}
        >
          Mark lost
        </Button>
      ) : null}

      {error ? (
        <p className="w-full text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <LostReasonDialog
        open={showLostDialog}
        onCancel={() => setShowLostDialog(false)}
        onConfirm={(lostReason) =>
          void changeStage("lost", { lostReason, confirmed: true })
        }
      />

      <StageConfirmDialog
        open={showConfirm}
        move={
          pendingStage
            ? {
                card: { title: "this opportunity" },
                fromStage: currentStage,
                toStage: pendingStage,
              }
            : null
        }
        onCancel={() => {
          setShowConfirm(false);
          setPendingStage(null);
        }}
        onConfirm={() => {
          if (pendingStage) {
            void changeStage(pendingStage, { confirmed: true });
          }
        }}
      />
    </div>
  );
}
