"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import {
  ProductionBoardCardOverlay,
  ProductionBoardCardView,
} from "@/components/production/production-board-card";
import {
  PRODUCTION_BOARD_COLUMNS,
  PRODUCTION_STATUS_LABELS,
} from "@/lib/production/constants";
import type { ProductionStatus } from "@/lib/production/constants";
import type { ProductionBoardCard, ProductionBoardData } from "@/lib/production/types";
import { cn } from "@/lib/utils";

type ProductionBoardProps = {
  initialData: ProductionBoardData;
};

type PendingMove = {
  card: ProductionBoardCard;
  fromStage: ProductionStatus;
  toStage: ProductionStatus;
};

function DraggableProductionCard({
  card,
  isUpdating,
}: {
  card: ProductionBoardCard;
  isUpdating: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: card.id,
      data: { card },
      disabled: isUpdating,
    });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(isUpdating && "pointer-events-none opacity-50")}
    >
      <ProductionBoardCardView card={card} isDragging={isDragging} />
    </div>
  );
}

function ProductionColumn({
  stage,
  cards,
  count,
  isUpdating,
}: {
  stage: ProductionStatus;
  cards: ProductionBoardCard[];
  count: number;
  isUpdating: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-3 rounded-xl border border-border bg-muted/40 px-3 py-3">
        <p className="text-sm font-semibold text-foreground">
          {PRODUCTION_STATUS_LABELS[stage]}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {count} {count === 1 ? "item" : "items"}
        </p>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[12rem] flex-1 flex-col gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 p-2 transition-colors",
          isOver && "border-[var(--candid-yellow)] bg-muted/40"
        )}
      >
        {cards.map((card) => (
          <DraggableProductionCard
            key={card.id}
            card={card}
            isUpdating={isUpdating}
          />
        ))}
      </div>
    </div>
  );
}

export function ProductionBoard({ initialData }: ProductionBoardProps) {
  const router = useRouter();
  const [boardData, setBoardData] = useState(initialData);
  const [activeCard, setActiveCard] = useState<ProductionBoardCard | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const stages = useMemo(() => PRODUCTION_BOARD_COLUMNS, []);

  function findCardStage(cardId: string) {
    for (const stage of stages) {
      if (boardData.columns[stage].some((card) => card.id === cardId)) {
        return stage;
      }
    }
    return null;
  }

  function handleDragStart(event: DragStartEvent) {
    const card = event.active.data.current?.card as ProductionBoardCard | undefined;
    setActiveCard(card ?? null);
    setError("");
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);

    const card = event.active.data.current?.card as ProductionBoardCard | undefined;
    const toStage = event.over?.id as ProductionStatus | undefined;

    if (!card || !toStage || !stages.includes(toStage)) {
      return;
    }

    const fromStage = findCardStage(card.id);

    if (!fromStage || fromStage === toStage) {
      return;
    }

    const move: PendingMove = { card, fromStage, toStage };
    const previousSnapshot = boardData;

    setIsUpdating(true);
    setError("");

    setBoardData((current) => {
      const nextColumns = { ...current.columns };
      nextColumns[move.fromStage] = nextColumns[move.fromStage].filter(
        (c) => c.id !== move.card.id
      );
      nextColumns[move.toStage] = [
        {
          ...move.card,
          production_status: move.toStage,
          is_on_hold: move.toStage === "on_hold",
        },
        ...nextColumns[move.toStage],
      ];

      const nextCounts = { ...current.counts };
      nextCounts[move.fromStage] = nextColumns[move.fromStage].length;
      nextCounts[move.toStage] = nextColumns[move.toStage].length;

      return {
        columns: nextColumns,
        counts: nextCounts,
        totalCount: current.totalCount,
      };
    });

    try {
      const response = await fetch(
        `/api/admin/production/items/${move.card.id}/stage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stage: move.toStage,
            previousStage: move.fromStage,
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
    }
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
            <ProductionColumn
              key={stage}
              stage={stage}
              cards={boardData.columns[stage]}
              count={boardData.counts[stage]}
              isUpdating={isUpdating}
            />
          ))}
        </div>

        <DragOverlay>
          {activeCard ? <ProductionBoardCardOverlay card={activeCard} /> : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}
