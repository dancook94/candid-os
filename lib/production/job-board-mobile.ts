import {
  JOB_PRODUCTION_BOARD_COLUMNS,
  JOB_PRODUCTION_BOARD_STAGE_LABELS,
  JOB_PRODUCTION_BOARD_STAGES,
  type JobProductionBoardStage,
} from "@/lib/production/job-board-constants";
import type {
  JobProductionBoardCard,
  JobProductionBoardData,
} from "@/lib/production/job-board-service";

export type MobileProductionBoardStageFilter = "all" | JobProductionBoardStage;

export const MOBILE_PRODUCTION_BOARD_STAGE_OPTIONS: Array<{
  value: MobileProductionBoardStageFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  ...JOB_PRODUCTION_BOARD_STAGES.map((stage) => ({
    value: stage,
    label: JOB_PRODUCTION_BOARD_STAGE_LABELS[stage],
  })),
];

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function resolveJobProductionBoardCardStage(
  card: JobProductionBoardCard
): JobProductionBoardStage {
  return card.is_on_hold ? "on_hold" : card.production_board_stage;
}

export function sortJobProductionBoardCards(cards: JobProductionBoardCard[]) {
  return [...cards].sort((a, b) => {
    if (a.is_overdue !== b.is_overdue) {
      return a.is_overdue ? -1 : 1;
    }

    if (a.is_due_today !== b.is_due_today) {
      return a.is_due_today ? -1 : 1;
    }

    const priorityA = a.priority_label ? PRIORITY_RANK[a.priority_label] ?? 99 : 99;
    const priorityB = b.priority_label ? PRIORITY_RANK[b.priority_label] ?? 99 : 99;

    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    if (a.required_date && b.required_date) {
      const dateDiff =
        new Date(a.required_date).getTime() - new Date(b.required_date).getTime();

      if (dateDiff !== 0) {
        return dateDiff;
      }
    } else if (a.required_date) {
      return -1;
    } else if (b.required_date) {
      return 1;
    }

    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

export function flattenJobProductionBoardCards(
  data: JobProductionBoardData,
  stageFilter: MobileProductionBoardStageFilter = "all"
) {
  const stages =
    stageFilter === "all"
      ? ([...JOB_PRODUCTION_BOARD_COLUMNS, "on_hold"] as JobProductionBoardStage[])
      : [stageFilter];

  const cards = stages.flatMap((stage) => data.columns[stage] ?? []);
  return sortJobProductionBoardCards(cards);
}

export function countJobsForMobileStageFilter(
  data: JobProductionBoardData,
  stageFilter: MobileProductionBoardStageFilter
) {
  if (stageFilter === "all") {
    return data.totalCount;
  }

  return data.counts[stageFilter] ?? 0;
}
