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
  JobProductionBoardCardOverlay,
  JobProductionBoardCardView,
} from "@/components/production/job-production-board-card";
import {
  JOB_PRODUCTION_BOARD_COLUMNS,
  JOB_PRODUCTION_BOARD_STAGE_LABELS,
  type JobProductionBoardStage,
} from "@/lib/production/job-board-constants";
import type { JobProductionBoardData } from "@/lib/production/job-board-service";
import { cn } from "@/lib/utils";

type JobProductionBoardProps = {
  initialData: JobProductionBoardData;
};

type PendingMove = {
  cardId: string;
  fromStage: JobProductionBoardStage;
  toStage: JobProductionBoardStage;
};

function DraggableJobCard({
  card,
  isUpdating,
  onDeadlineUpdated,
}: {
  card: JobProductionBoardData["columns"][JobProductionBoardStage][number];
  isUpdating: boolean;
  onDeadlineUpdated: (updatedCard: JobProductionBoardData["columns"][JobProductionBoardStage][number]) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: card.id,
      data: { card },
      disabled: isUpdating || card.production_board_stage === "accepted_quotes",
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
      <JobProductionBoardCardView
        card={card}
        isDragging={isDragging}
        onDeadlineUpdated={onDeadlineUpdated}
      />
    </div>
  );
}

function JobProductionColumn({
  stage,
  cards,
  count,
  isUpdating,
  onDeadlineUpdated,
}: {
  stage: JobProductionBoardStage;
  cards: JobProductionBoardData["columns"][JobProductionBoardStage];
  count: number;
  isUpdating: boolean;
  onDeadlineUpdated: (updatedCard: JobProductionBoardData["columns"][JobProductionBoardStage][number]) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  return (
    <div className="flex w-80 shrink-0 flex-col">
      <div className="mb-3 rounded-xl border border-border bg-muted/40 px-3 py-3">
        <p className="text-sm font-semibold text-foreground">
          {JOB_PRODUCTION_BOARD_STAGE_LABELS[stage]}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {count} {count === 1 ? "job" : "jobs"}
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
          <DraggableJobCard
            key={card.id}
            card={card}
            isUpdating={isUpdating}
            onDeadlineUpdated={onDeadlineUpdated}
          />
        ))}
      </div>
    </div>
  );
}

export function JobProductionBoard({ initialData }: JobProductionBoardProps) {
  const router = useRouter();
  const [boardData, setBoardData] = useState(initialData);
  const [activeCard, setActiveCard] = useState<
    JobProductionBoardData["columns"][JobProductionBoardStage][number] | null
  >(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const allColumns = useMemo(
    () => [...JOB_PRODUCTION_BOARD_COLUMNS, "on_hold" as const],
    []
  );

  function handleDeadlineUpdated(
    updatedCard: JobProductionBoardData["columns"][JobProductionBoardStage][number]
  ) {
    const stage = findCardStage(updatedCard.id);

    if (!stage) {
      return;
    }

    setBoardData((current) => ({
      ...current,
      columns: {
        ...current.columns,
        [stage]: current.columns[stage].map((entry) =>
          entry.id === updatedCard.id ? updatedCard : entry
        ),
      },
    }));
  }

  function findCardStage(cardId: string): JobProductionBoardStage | null {
    for (const stage of allColumns) {
      if (boardData.columns[stage]?.some((card) => card.id === cardId)) {
        return stage;
      }
    }

    return null;
  }

  function handleDragStart(event: DragStartEvent) {
    const card = event.active.data.current?.card;

    if (card) {
      setActiveCard(card);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);

    const cardId = String(event.active.id);
    const toStage = event.over?.id as JobProductionBoardStage | undefined;
    const fromStage = findCardStage(cardId);

    if (!toStage || !fromStage || toStage === fromStage) {
      return;
    }

    if (fromStage === "accepted_quotes" && toStage !== "ready_to_print") {
      setError("Jobs leave Accepted Quotes automatically when production readiness is complete.");
      return;
    }

    const card = boardData.columns[fromStage]?.find((entry) => entry.id === cardId);

    if (!card) {
      return;
    }

    const previousData = boardData;
    const nextColumns = { ...boardData.columns };
    nextColumns[fromStage] = nextColumns[fromStage].filter(
      (entry) => entry.id !== cardId
    );
    nextColumns[toStage] = [
      { ...card, production_board_stage: toStage, is_on_hold: toStage === "on_hold" },
      ...nextColumns[toStage],
    ];

    const nextCounts = { ...boardData.counts };
    nextCounts[fromStage] = Math.max(0, nextCounts[fromStage] - 1);
    nextCounts[toStage] = nextCounts[toStage] + 1;

    setBoardData({
      columns: nextColumns,
      counts: nextCounts,
      totalCount: boardData.totalCount,
    });
    setIsUpdating(true);
    setError("");

    try {
      const response = await fetch(
        `/api/admin/jobs/${cardId}/production-board-stage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stage: toStage,
            previousStage: fromStage,
          }),
        }
      );

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Unable to move job.");
      }

      router.refresh();
    } catch (moveError) {
      setBoardData(previousData);
      setError(
        moveError instanceof Error ? moveError.message : "Unable to move job."
      );
    } finally {
      setIsUpdating(false);
    }
  }

  return (
    <div>
      {error ? (
        <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <DndContext
        id="job-production-board"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={(event) => void handleDragEnd(event)}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {allColumns.map((stage) => (
            <JobProductionColumn
              key={stage}
              stage={stage}
              cards={boardData.columns[stage] ?? []}
              count={boardData.counts[stage] ?? 0}
              isUpdating={isUpdating}
              onDeadlineUpdated={handleDeadlineUpdated}
            />
          ))}
        </div>

        <DragOverlay>
          {activeCard ? (
            <JobProductionBoardCardOverlay card={activeCard} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
