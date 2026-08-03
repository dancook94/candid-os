import type { ProductionRequirementStatus } from "@/lib/manifest/constants";
import type { ManifestItemRecord } from "@/lib/manifest/types";

export type ProductionReadinessSummary = {
  activeRequiredCount: number;
  satisfiedCount: number;
  isReady: boolean;
  hasOverride: boolean;
  label: string;
};

const SATISFIED_REQUIREMENT_STATUSES: ProductionRequirementStatus[] = [
  "satisfied",
  "cancelled",
  "not_required",
  "combined",
  "external",
  "manual_production",
];

export function isRequirementSatisfied(
  item: Pick<
    ManifestItemRecord,
    | "production_requirement_status"
    | "requires_printfactory"
    | "printfactory_satisfied"
    | "deleted_at"
    | "combined_into_item_id"
  >
) {
  if (item.deleted_at || item.combined_into_item_id) {
    return true;
  }

  if (SATISFIED_REQUIREMENT_STATUSES.includes(item.production_requirement_status)) {
    return true;
  }

  if (item.requires_printfactory && item.printfactory_satisfied) {
    return true;
  }

  return false;
}

export function isActiveRequiredItem(
  item: Pick<
    ManifestItemRecord,
    | "production_requirement_status"
    | "deleted_at"
    | "combined_into_item_id"
  >
) {
  if (item.deleted_at || item.combined_into_item_id) {
    return false;
  }

  return item.production_requirement_status === "required";
}

export function calculateProductionReadiness(
  items: ManifestItemRecord[],
  options: { hasOverride?: boolean } = {}
): ProductionReadinessSummary {
  const activeRequired = items.filter(isActiveRequiredItem);
  const satisfied = activeRequired.filter(isRequirementSatisfied);
  const activeRequiredCount = activeRequired.length;
  const satisfiedCount = satisfied.length;
  const isReady =
    options.hasOverride ||
    activeRequiredCount === 0 ||
    satisfiedCount === activeRequiredCount;

  return {
    activeRequiredCount,
    satisfiedCount,
    isReady,
    hasOverride: Boolean(options.hasOverride),
    label:
      activeRequiredCount === 0
        ? "No active production requirements"
        : `${satisfiedCount} of ${activeRequiredCount} active requirements satisfied`,
  };
}
