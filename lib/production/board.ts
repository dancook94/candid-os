import type { ProductionPriority, ProductionStatus } from "@/lib/production/constants";
import {
  PRODUCTION_BOARD_COLUMNS,
  PRODUCTION_STATUS_LABELS,
} from "@/lib/production/constants";
import type {
  ProductionBoardCard,
  ProductionBoardData,
  ProductionBoardFilters,
} from "@/lib/production/types";

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function computeDeadlineFlags(
  requiredAt: string | null,
  productionStatus: ProductionStatus
) {
  const isCompleted = productionStatus === "completed";
  const isOnHold = productionStatus === "on_hold";

  if (!requiredAt || isCompleted) {
    return {
      is_overdue: false,
      is_due_today: false,
      is_due_tomorrow: false,
      is_on_hold: isOnHold,
    };
  }

  const due = new Date(requiredAt);
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return {
    is_overdue: due < now && !isCompleted && !isOnHold,
    is_due_today: isSameDay(due, today) && !isCompleted,
    is_due_tomorrow: isSameDay(due, tomorrow) && !isCompleted,
    is_on_hold: isOnHold,
  };
}

const PRIORITY_RANK: Record<ProductionPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function sortProductionBoardCards(cards: ProductionBoardCard[]) {
  return [...cards].sort((a, b) => {
    if (a.is_overdue !== b.is_overdue) {
      return a.is_overdue ? -1 : 1;
    }

    const priorityDiff =
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    if (a.required_at && b.required_at) {
      const dateDiff =
        new Date(a.required_at).getTime() - new Date(b.required_at).getTime();

      if (dateDiff !== 0) {
        return dateDiff;
      }
    } else if (a.required_at) {
      return -1;
    } else if (b.required_at) {
      return 1;
    }

    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

export function buildEmptyBoardData(): ProductionBoardData {
  const columns = {} as Record<ProductionStatus, ProductionBoardCard[]>;
  const counts = {} as Record<ProductionStatus, number>;

  for (const stage of PRODUCTION_BOARD_COLUMNS) {
    columns[stage] = [];
    counts[stage] = 0;
  }

  return { columns, counts, totalCount: 0 };
}

export function groupCardsIntoBoardData(
  cards: ProductionBoardCard[]
): ProductionBoardData {
  const data = buildEmptyBoardData();

  for (const card of cards) {
    data.columns[card.production_status].push(card);
  }

  for (const stage of PRODUCTION_BOARD_COLUMNS) {
    data.columns[stage] = sortProductionBoardCards(data.columns[stage]);
    data.counts[stage] = data.columns[stage].length;
    data.totalCount += data.counts[stage];
  }

  return data;
}

export type ProductionBoardSearchParams = {
  search?: string;
  company?: string;
  staff?: string;
  machine?: string;
  material?: string;
  priority?: string;
  due?: string;
  job_ref?: string;
};

export function parseProductionBoardFilters(
  params: ProductionBoardSearchParams
): ProductionBoardFilters {
  const priority = params.priority?.trim();

  return {
    search: params.search?.trim() ?? "",
    companyId: params.company?.trim() || null,
    assignedToProfileId: params.staff?.trim() || null,
    machine: params.machine?.trim() || null,
    material: params.material?.trim() || null,
    priority:
      priority === "low" ||
      priority === "normal" ||
      priority === "high" ||
      priority === "urgent"
        ? priority
        : null,
    dueDate:
      params.due === "overdue" ||
      params.due === "today" ||
      params.due === "tomorrow"
        ? params.due
        : null,
    jobReference: params.job_ref?.trim() || null,
  };
}

export function hasActiveProductionBoardFilters(
  filters: ProductionBoardFilters
) {
  return Boolean(
    filters.search ||
      filters.companyId ||
      filters.assignedToProfileId ||
      filters.machine ||
      filters.material ||
      filters.priority ||
      filters.dueDate ||
      filters.jobReference
  );
}

export function buildProductionBoardHref(
  filters: ProductionBoardFilters
): string {
  const params = new URLSearchParams();

  if (filters.search) params.set("search", filters.search);
  if (filters.companyId) params.set("company", filters.companyId);
  if (filters.assignedToProfileId) params.set("staff", filters.assignedToProfileId);
  if (filters.machine) params.set("machine", filters.machine);
  if (filters.material) params.set("material", filters.material);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.dueDate) params.set("due", filters.dueDate);
  if (filters.jobReference) params.set("job_ref", filters.jobReference);

  const query = params.toString();
  return query ? `/admin/production?${query}` : "/admin/production";
}

export function getProductionStageOptions() {
  return PRODUCTION_BOARD_COLUMNS.map((status) => ({
    value: status,
    label: PRODUCTION_STATUS_LABELS[status],
  }));
}
