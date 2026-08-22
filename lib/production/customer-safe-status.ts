import type { JobProductionBoardStage } from "@/lib/production/job-board-constants";

/** Maps internal production board stages to customer-safe portal labels. */
export function mapProductionBoardStageToCustomerStatus(
  stage: JobProductionBoardStage | string | null | undefined
): string {
  switch (stage) {
    case "accepted_quotes":
      return "Artwork / proof preparation";
    case "ready_to_print":
      return "Ready for production";
    case "printed":
    case "laminating":
    case "finishing":
    case "cutting":
      return "In production";
    case "dispatch":
      return "Preparing for dispatch";
    case "complete_job":
      return "Completed";
    case "on_hold":
      return "On hold";
    default:
      return "In production";
  }
}

export function mapProductionBoardStageToCustomerSafeStatus(
  stage: JobProductionBoardStage | string | null | undefined,
  fulfilmentMethod?: string | null
): string {
  if (stage === "dispatch") {
    const method = fulfilmentMethod?.toLowerCase() ?? "";
    if (method.includes("dispatch") || method.includes("delivery")) {
      return "Dispatched";
    }
    if (method.includes("collection")) {
      return "Ready for collection";
    }
    return "Preparing for dispatch";
  }

  return mapProductionBoardStageToCustomerStatus(stage);
}
