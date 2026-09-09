"use client";

import { useState } from "react";
import { CalendarClock, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  applyRequiredDateToJobBoardCard,
  formatProductionBoardDeadline,
  requiredDateToDeadlineInput,
} from "@/lib/jobs/production-deadline";
import type { JobProductionBoardCard } from "@/lib/production/job-board-service";
import { cn } from "@/lib/utils";

type JobProductionBoardDeadlineControlProps = {
  card: JobProductionBoardCard;
  onUpdated?: (card: JobProductionBoardCard) => void;
  className?: string;
};

export function JobProductionBoardDeadlineControl({
  card,
  onUpdated,
  className,
}: JobProductionBoardDeadlineControlProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftDate, setDraftDate] = useState(requiredDateToDeadlineInput(card.required_date));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  async function saveDeadline(nextDate: string | null) {
    setError("");
    setIsSaving(true);

    try {
      const response = await fetch(`/api/admin/jobs/${card.id}/required-date`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requiredDate: nextDate }),
      });

      const payload = (await response.json()) as {
        requiredDate?: string | null;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update production deadline.");
      }

      const updatedCard = applyRequiredDateToJobBoardCard(
        card,
        payload.requiredDate ?? null
      );

      onUpdated?.(updatedCard);
      setDraftDate(requiredDateToDeadlineInput(updatedCard.required_date));
      setIsEditing(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to update production deadline."
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isEditing) {
    return (
      <div
        className={cn("rounded-lg border border-border bg-background p-2", className)}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <Input
          type="date"
          value={draftDate}
          onChange={(event) => setDraftDate(event.target.value)}
          disabled={isSaving}
          className="h-8"
        />
        <div className="mt-2 flex flex-wrap gap-1">
          <Button
            type="button"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={isSaving}
            onClick={() => void saveDeadline(draftDate || null)}
          >
            Save
          </Button>
          {card.required_date ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={isSaving}
              onClick={() => void saveDeadline(null)}
            >
              Clear
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={isSaving}
            onClick={() => {
              setDraftDate(requiredDateToDeadlineInput(card.required_date));
              setIsEditing(false);
              setError("");
            }}
          >
            Cancel
          </Button>
        </div>
        {error ? <p className="mt-1 text-[11px] text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div
      className={cn("flex items-center gap-1", className)}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <CalendarClock className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
      <span
        className={cn(
          "text-xs",
          card.required_date ? "text-muted-foreground" : "text-muted-foreground/80 italic"
        )}
      >
        {formatProductionBoardDeadline(card.required_date)}
        {card.required_date && card.fulfilment_method ? ` · ${card.fulfilment_method}` : ""}
      </span>
      <button
        type="button"
        className="rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        aria-label="Edit production deadline"
        onClick={() => {
          setDraftDate(requiredDateToDeadlineInput(card.required_date));
          setIsEditing(true);
        }}
      >
        <Pencil className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}
