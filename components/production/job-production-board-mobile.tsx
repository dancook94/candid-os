"use client";

import { useMemo, useState } from "react";

import { JobProductionBoardMobileCard } from "@/components/production/job-production-board-mobile-card";
import {
  MOBILE_PRODUCTION_BOARD_STAGE_OPTIONS,
  countJobsForMobileStageFilter,
  flattenJobProductionBoardCards,
  type MobileProductionBoardStageFilter,
} from "@/lib/production/job-board-mobile";
import type { JobProductionBoardData } from "@/lib/production/job-board-service";
import { cn } from "@/lib/utils";

type JobProductionBoardMobileProps = {
  initialData: JobProductionBoardData;
};

export function JobProductionBoardMobile({ initialData }: JobProductionBoardMobileProps) {
  const [stageFilter, setStageFilter] =
    useState<MobileProductionBoardStageFilter>("all");

  const visibleCards = useMemo(
    () => flattenJobProductionBoardCards(initialData, stageFilter),
    [initialData, stageFilter]
  );

  return (
    <div className="space-y-4">
      <div className="-mx-1 overflow-x-auto overscroll-x-contain px-1 pb-1">
        <div className="flex w-max min-w-full gap-2">
          {MOBILE_PRODUCTION_BOARD_STAGE_OPTIONS.map((option) => {
            const count = countJobsForMobileStageFilter(initialData, option.value);
            const isActive = stageFilter === option.value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setStageFilter(option.value)}
                aria-pressed={isActive}
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition-colors",
                  isActive
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                )}
              >
                <span>{option.label}</span>
                <span
                  className={cn(
                    "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                    isActive ? "bg-background/15 text-background" : "bg-muted text-foreground"
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {visibleCards.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          No jobs in this stage.
        </p>
      ) : (
        <div className="space-y-3">
          {visibleCards.map((card) => (
            <JobProductionBoardMobileCard key={card.id} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}
