import { isActiveRequiredItem } from "@/lib/manifest/readiness";
import {
  buildManifestItemProofCoverage,
  findUncoveredProofRequiredItemReferences,
  isManifestItemProofApproved,
  type ManifestItemProofCoverage,
} from "@/lib/manifest/proof-requirement";
import type { ManifestItemRecord } from "@/lib/manifest/types";
import type { ProofRecordForItemCoverage } from "@/lib/manifest/proof-requirement";

export type ProofCoverageContext = ManifestItemProofCoverage;

export function buildProofCoverageContext(
  proofRequired: boolean,
  approvedProofIds: string[],
  links: Array<{ proof_id: string; production_item_id: string }>,
  options?: {
    manifestItems?: ManifestItemRecord[];
    proofs?: ProofRecordForItemCoverage[];
  }
): ProofCoverageContext {
  if (options?.manifestItems?.length) {
    return buildManifestItemProofCoverage(
      options.manifestItems,
      options.proofs ?? [],
      links
    );
  }

  if (!proofRequired) {
    return {
      proofRequired: false,
      proofRequiredItemIds: new Set(),
      satisfiedItemIds: new Set(),
      pendingDecisionItemIds: new Set(),
      coveredItemIds: new Set(),
      hasWholeJobApprovedCoverage: true,
      requiredCount: 0,
      satisfiedCount: 0,
      pendingDecisionCount: 0,
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
    proofRequired: true,
    proofRequiredItemIds: coveredItemIds,
    satisfiedItemIds: coveredItemIds,
    pendingDecisionItemIds: new Set(),
    coveredItemIds,
    hasWholeJobApprovedCoverage,
    requiredCount: coveredItemIds.size,
    satisfiedCount: coveredItemIds.size,
    pendingDecisionCount: 0,
  };
}

export function isManifestItemProofSatisfied(
  item: Pick<
    ManifestItemRecord,
    | "id"
    | "proof_requirement"
    | "deleted_at"
    | "combined_into_item_id"
    | "production_requirement_status"
  >,
  coverage: ProofCoverageContext,
  proofs: ProofRecordForItemCoverage[] = [],
  links: Array<{ proof_id: string; production_item_id: string }> = []
) {
  if (proofs.length > 0 || item.proof_requirement) {
    return isManifestItemProofApproved(item, proofs, links);
  }

  if (!coverage.proofRequired) {
    return true;
  }

  if (coverage.hasWholeJobApprovedCoverage) {
    return true;
  }

  return coverage.coveredItemIds.has(item.id);
}

export function findUncoveredRequiredItemReferences(
  manifestItems: ManifestItemRecord[],
  coverage: ProofCoverageContext
) {
  if (coverage.proofRequiredItemIds.size > 0 || coverage.pendingDecisionCount > 0) {
    return findUncoveredProofRequiredItemReferences(manifestItems, coverage);
  }

  if (!coverage.proofRequired || coverage.hasWholeJobApprovedCoverage) {
    return [];
  }

  return manifestItems
    .filter(isActiveRequiredItem)
    .filter((item) => !coverage.coveredItemIds.has(item.id))
    .map((item) => item.item_reference ?? item.item_name);
}
