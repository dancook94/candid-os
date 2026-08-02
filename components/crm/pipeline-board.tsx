"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";

import { PipelineCardOverlay, PipelineCardView } from "@/components/crm/pipeline-card";
import { LostReasonDialog } from "@/components/crm/lost-reason-dialog";
import { StageConfirmDialog } from "@/components/crm/stage-confirm-dialog";
import { OPPORTUNITY_STAGE_LABELS } from "@/lib/crm/opportunity-stages";
import type { PipelineBoardData, PipelineCard } from "@/lib/crm/pipeline-board";
import type { OpportunityStage } from "@/lib/crm/types";
import { formatGbp } from "@/lib/format-currency";
import { cn } from "@/lib/utils";
import { useDraggable } from "@dnd-kit/core";

type PipelineBoardProps = {
  initialData: PipelineBoardData;
};

type PendingMove = {
  card: PipelineCard;
  fromStage: OpportunityStage;
  toStage: OpportunityStage;
};

function DraggableCard({
  card,
  isUpdating,
}: {
  card: PipelineCard;
  isUpdating: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: card.id,
      data: { card },
      disabled: isUpdating,
    });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(isUpdating && "pointer-events-none opacity-50")}
    >
      <PipelineCardView card={card} isDragging={isDragging} />
    </div>
  );
}

function PipelineColumn({
  stage,
  cards,
  totals,
  isUpdating,
}: {
  stage: OpportunityStage;
  cards: PipelineCard[];
  totals: { count: number; estimatedTotal: number; quoteTotal: number };
  isUpdating: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-3 rounded-xl border border-border bg-muted/40 px-3 py-3">
        <p className="text-sm font-semibold text-foreground">
          {OPPORTUNITY_STAGE_LABELS[stage]}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {totals.count} {totals.count === 1 ? "opportunity" : "opportunities"}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatGbp(totals.estimatedTotal)} estimated
        </p>
        {totals.quoteTotal > 0 ? (
          <p className="text-xs font-medium text-foreground">
            {formatGbp(totals.quoteTotal)} quoted
          </p>
        ) : null}
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[12rem] flex-1 flex-col gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 p-2 transition-colors",
          isOver && "border-[var(--candid-yellow)] bg-muted/40"
        )}
      >
        {cards.map((card) => (
          <DraggableCard key={card.id} card={card} isUpdating={isUpdating} />
        ))}
      </div>
    </div>
  );
}

export function PipelineBoard({ initialData }: PipelineBoardProps) {
  const router = useRouter();
  const [boardData, setBoardData] = useState(initialData);
  const [activeCard, setActiveCard] = useState<PipelineCard | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [showLostDialog, setShowLostDialog] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const stages = useMemo(
    () => Object.keys(boardData.columns) as OpportunityStage[],
    [boardData.columns]
  );

  function findCardStage(cardId: string) {
    for (const stage of stages) {
      if (boardData.columns[stage].some((card) => card.id === cardId)) {
        return stage;
      }
    }
    return null;
  }

  function handleDragStart(event: DragStartEvent) {
    const card = event.active.data.current?.card as PipelineCard | undefined;
    setActiveCard(card ?? null);
    setError("");
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);

    const card = event.active.data.current?.card as PipelineCard | undefined;
    const toStage = event.over?.id as OpportunityStage | undefined;

    if (!card || !toStage || !stages.includes(toStage)) {
      return;
    }

    const fromStage = findCardStage(card.id);

    if (!fromStage || fromStage === toStage) {
      return;
    }

    const move: PendingMove = { card, fromStage, toStage };

    if (toStage === "lost") {
      setPendingMove(move);
      setShowLostDialog(true);
      return;
    }

    if (
      toStage === "won" ||
      fromStage === "won" ||
      fromStage === "lost"
    ) {
      setPendingMove(move);
      setShowConfirmDialog(true);
      return;
    }

    void commitStageChange(move);
  }

  async function commitStageChange(
    move: PendingMove,
    options?: { lostReason?: string; confirmed?: boolean }
  ) {
    setIsUpdating(true);
    setError("");

    const previousSnapshot = boardData;

    setBoardData((current) => {
      const nextColumns = { ...current.columns };
      nextColumns[move.fromStage] = nextColumns[move.fromStage].filter(
        (c) => c.id !== move.card.id
      );
      nextColumns[move.toStage] = [
        { ...move.card, stage: move.toStage },
        ...nextColumns[move.toStage],
      ];

      const nextTotals = { ...current.totals };
      nextTotals[move.fromStage] = recalcTotals(nextColumns[move.fromStage]);
      nextTotals[move.toStage] = recalcTotals(nextColumns[move.toStage]);

      return { columns: nextColumns, totals: nextTotals };
    });

    try {
      const response = await fetch(
        `/api/crm/opportunities/${move.card.id}/stage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stage: move.toStage,
            previousStage: move.fromStage,
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
      setBoardData(previousSnapshot);
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Unable to update stage."
      );
    } finally {
      setIsUpdating(false);
      setPendingMove(null);
      setShowLostDialog(false);
      setShowConfirmDialog(false);
    }
  }

  function recalcTotals(cards: PipelineCard[]) {
    return cards.reduce(
      (acc, card) => ({
        count: acc.count + 1,
        estimatedTotal: acc.estimatedTotal + (card.estimated_value ?? 0),
        quoteTotal: acc.quoteTotal + (card.current_quote_value ?? 0),
      }),
      { count: 0, estimatedTotal: 0, quoteTotal: 0 }
    );
  }

  return (
    <>
      {error ? (
        <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {isUpdating ? (
        <p className="mb-4 text-sm text-muted-foreground">Updating stage…</p>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {stages.map((stage) => (
            <PipelineColumn
              key={stage}
              stage={stage}
              cards={boardData.columns[stage]}
              totals={boardData.totals[stage]}
              isUpdating={isUpdating}
            />
          ))}
        </div>

        <DragOverlay>
          {activeCard ? <PipelineCardOverlay card={activeCard} /> : null}
        </DragOverlay>
      </DndContext>

      <LostReasonDialog
        open={showLostDialog}
        onCancel={() => {
          setShowLostDialog(false);
          setPendingMove(null);
        }}
        onConfirm={(lostReason) => {
          if (pendingMove) {
            void commitStageChange(pendingMove, {
              lostReason,
              confirmed: true,
            });
          }
        }}
      />

      <StageConfirmDialog
        open={showConfirmDialog}
        move={pendingMove}
        onCancel={() => {
          setShowConfirmDialog(false);
          setPendingMove(null);
        }}
        onConfirm={() => {
          if (pendingMove) {
            void commitStageChange(pendingMove, { confirmed: true });
          }
        }}
      />
    </>
  );
}
