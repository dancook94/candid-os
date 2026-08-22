import type { ProductionRequirementStatus } from "@/lib/manifest/constants";
import type { ManifestItemRecord } from "@/lib/manifest/types";
import type { CustomerProofStatus } from "@/lib/proofs/customer-state";
import {
  type ProofCoverageContext,
  isManifestItemProofSatisfied,
} from "@/lib/proofs/coverage";

export type ProductionReadinessSummary = {
  activeRequiredCount: number;
  satisfiedCount: number;
  isReady: boolean;
  hasOverride: boolean;
  label: string;
  proofBlocked?: boolean;
  proofStatusLabel?: string;
  unresolvedRequirements?: string[];
  unresolvedDetails?: string[];
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

const PROOF_BLOCKER_LABELS: Record<CustomerProofStatus, string> = {
  not_required: "proof not required",
  preparing: "proof being prepared",
  awaiting_approval: "awaiting customer approval",
  changes_requested: "proof changes requested",
  approved: "proof approved",
};

export function getManifestItemProductionBlockers(
  item: Pick<
    ManifestItemRecord,
    | "id"
    | "item_reference"
    | "item_name"
    | "production_requirement_status"
    | "requires_printfactory"
    | "printfactory_satisfied"
    | "deleted_at"
    | "combined_into_item_id"
  >,
  coverage: ProofCoverageContext,
  proofStatus: CustomerProofStatus = "preparing"
) {
  if (!isActiveRequiredItem(item)) {
    return [];
  }

  if (isRequirementSatisfied(item)) {
    return [];
  }

  const blockers: string[] = [];

  if (!isManifestItemProofSatisfied(item.id, coverage)) {
    blockers.push(PROOF_BLOCKER_LABELS[proofStatus] ?? "awaiting proof");
  }

  if (item.requires_printfactory && !item.printfactory_satisfied) {
    blockers.push("awaiting PrintFactory");
  }

  return blockers;
}

export function isManifestItemProductionReady(
  item: Pick<
    ManifestItemRecord,
    | "id"
    | "production_requirement_status"
    | "requires_printfactory"
    | "printfactory_satisfied"
    | "deleted_at"
    | "combined_into_item_id"
  >,
  coverage: ProofCoverageContext
) {
  if (isRequirementSatisfied(item)) {
    return true;
  }

  if (!isActiveRequiredItem(item)) {
    return true;
  }

  const proofOk = isManifestItemProofSatisfied(item.id, coverage);
  const printFactoryOk = !item.requires_printfactory || item.printfactory_satisfied;

  return proofOk && printFactoryOk;
}

export function calculateProductionReadiness(
  items: ManifestItemRecord[],
  options: {
    hasOverride?: boolean;
    proofGateSatisfied?: boolean;
    proofStatusLabel?: string;
    proofCoverage?: ProofCoverageContext;
    proofStatus?: CustomerProofStatus;
  } = {}
): ProductionReadinessSummary {
  const activeRequired = items.filter(isActiveRequiredItem);
  const satisfied = options.proofCoverage
    ? activeRequired.filter((item) =>
        isManifestItemProductionReady(item, options.proofCoverage!)
      )
    : activeRequired.filter(isRequirementSatisfied);
  const activeRequiredCount = activeRequired.length;
  const satisfiedCount = satisfied.length;
  const productionReady =
    options.hasOverride ||
    activeRequiredCount === 0 ||
    satisfiedCount === activeRequiredCount;

  const proofGateSatisfied = options.proofCoverage
    ? true
    : options.proofGateSatisfied !== false;

  const isReady = productionReady && proofGateSatisfied;

  const unresolvedItems = activeRequired.filter((item) =>
    options.proofCoverage
      ? !isManifestItemProductionReady(item, options.proofCoverage)
      : !isRequirementSatisfied(item)
  );

  const unresolvedRequirements = unresolvedItems.map(
    (item) => item.item_reference ?? item.item_name
  );

  const unresolvedDetails = unresolvedItems.map((item) => {
    const reference = item.item_reference ?? item.item_name;
    const blockers = options.proofCoverage
      ? getManifestItemProductionBlockers(
          item,
          options.proofCoverage,
          options.proofStatus
        )
      : ["production requirement outstanding"];

    return `${reference} — ${blockers.join(", ")}`;
  });

  let label =
    activeRequiredCount === 0
      ? "No active production requirements"
      : `${satisfiedCount} of ${activeRequiredCount} items ready`;

  if (!options.proofCoverage && productionReady && !proofGateSatisfied) {
    label = `${label} · ${options.proofStatusLabel ?? "Proof approval required"}`;
  }

  return {
    activeRequiredCount,
    satisfiedCount,
    isReady,
    hasOverride: Boolean(options.hasOverride),
    proofBlocked: productionReady && !proofGateSatisfied,
    proofStatusLabel: options.proofStatusLabel,
    unresolvedRequirements,
    unresolvedDetails,
    label,
  };
}
