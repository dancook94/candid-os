import type { ProductionStatus } from "@/lib/production/constants";
import type { CustomerSafeStatus } from "@/lib/production/constants";
import type { JobStatus } from "@/lib/jobs/types";

const PRODUCTION_STATUS_RANK: Record<ProductionStatus, number> = {
  on_hold: -1,
  artwork: 0,
  ready_for_production: 1,
  printing: 2,
  cutting: 2,
  laminating: 2,
  finishing: 2,
  quality_check: 2,
  packing: 3,
  ready_for_dispatch: 3,
  completed: 4,
};

export function deriveCustomerSafeStatus(
  productionStatus: ProductionStatus
): CustomerSafeStatus {
  switch (productionStatus) {
    case "artwork":
    case "ready_for_production":
      return "artwork_being_prepared";
    case "printing":
    case "cutting":
    case "laminating":
    case "finishing":
    case "quality_check":
      return "in_production";
    case "packing":
    case "ready_for_dispatch":
      return "preparing_for_dispatch";
    case "completed":
      return "completed";
    case "on_hold":
      return "on_hold";
    default:
      return "artwork_being_prepared";
  }
}

export function deriveJobStatusFromProductionItems(
  itemStatuses: ProductionStatus[]
): JobStatus | null {
  if (itemStatuses.length === 0) {
    return null;
  }

  const activeStatuses = itemStatuses.filter((status) => status !== "on_hold");

  if (activeStatuses.length === 0) {
    return null;
  }

  if (activeStatuses.every((status) => status === "completed")) {
    return "completed";
  }

  const minRank = Math.min(
    ...activeStatuses.map((status) => PRODUCTION_STATUS_RANK[status])
  );

  if (minRank <= 1) {
    return "artwork_in_preparation";
  }

  if (minRank === 2) {
    return "in_production";
  }

  if (minRank === 3) {
    return "ready";
  }

  return "completed";
}

export function isValidProductionStatus(value: string): value is ProductionStatus {
  return value in PRODUCTION_STATUS_RANK;
}

export function canTransitionProductionStatus(
  from: ProductionStatus,
  to: ProductionStatus
): boolean {
  if (from === to) {
    return true;
  }

  // All transitions allowed in Phase 1; workshop staff may move freely.
  // on_hold can be entered or exited from any stage.
  return true;
}
