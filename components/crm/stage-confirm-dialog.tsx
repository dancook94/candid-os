"use client";

import { Button } from "@/components/ui/button";
import { OPPORTUNITY_STAGE_LABELS } from "@/lib/crm/opportunity-stages";
import type { OpportunityStage } from "@/lib/crm/types";

type PendingMove = {
  card: { title: string };
  fromStage: OpportunityStage;
  toStage: OpportunityStage;
};

type StageConfirmDialogProps = {
  open: boolean;
  move: PendingMove | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function StageConfirmDialog({
  open,
  move,
  onCancel,
  onConfirm,
}: StageConfirmDialogProps) {
  if (!open || !move) {
    return null;
  }

  const isWon = move.toStage === "won";
  const isReopen =
    move.fromStage === "won" || move.fromStage === "lost";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <h2 className="text-lg font-semibold">
          {isWon ? "Mark as won?" : isReopen ? "Reopen opportunity?" : "Confirm stage change"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Move <strong>{move.card.title}</strong> from{" "}
          {OPPORTUNITY_STAGE_LABELS[move.fromStage]} to{" "}
          {OPPORTUNITY_STAGE_LABELS[move.toStage]}?
        </p>
        {isReopen ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Terminal timestamps and lost reason will be cleared.
          </p>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm}>
            Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}
