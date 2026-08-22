import { isActiveRequiredItem } from "@/lib/manifest/readiness";
import type { ManifestItemRecord } from "@/lib/manifest/types";

export type ProofCoverageContext = {
  proofRequired: boolean;
  coveredItemIds: Set<string>;
  /** Approved proof exists with no explicit manifest links — covers all active items. */
  hasWholeJobApprovedCoverage: boolean;
};

export function buildProofCoverageContext(
  proofRequired: boolean,
  approvedProofIds: string[],
  links: Array<{ proof_id: string; production_item_id: string }>
): ProofCoverageContext {
  if (!proofRequired) {
    return {
      proofRequired: false,
      coveredItemIds: new Set(),
      hasWholeJobApprovedCoverage: true,
    };
  }

  const approvedProofIdSet = new Set(approvedProofIds);
  const coveredItemIds = new Set<string>();

  for (const link of links) {
    if (approvedProofIdSet.has(link.proof_id)) {
      coveredItemIds.add(link.production_item_id);
    }
  }

  const hasWholeJobApprovedCoverage =
    approvedProofIds.length > 0 && coveredItemIds.size === 0;

  return {
    proofRequired,
    coveredItemIds,
    hasWholeJobApprovedCoverage,
  };
}

export function isManifestItemProofSatisfied(
  itemId: string,
  coverage: ProofCoverageContext
) {
  if (!coverage.proofRequired) {
    return true;
  }

  if (coverage.hasWholeJobApprovedCoverage) {
    return true;
  }

  return coverage.coveredItemIds.has(itemId);
}

export function findUncoveredRequiredItemReferences(
  manifestItems: ManifestItemRecord[],
  coverage: ProofCoverageContext
) {
  if (!coverage.proofRequired || coverage.hasWholeJobApprovedCoverage) {
    return [];
  }

  return manifestItems
    .filter(isActiveRequiredItem)
    .filter((item) => !coverage.coveredItemIds.has(item.id))
    .map((item) => item.item_reference ?? item.item_name);
}
