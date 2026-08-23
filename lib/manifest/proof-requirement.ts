import { isLikelyNonPrintLine } from "@/lib/manifest/constants";
import type { ManifestItemRecord } from "@/lib/manifest/types";
import { getCurrentProofInLineage } from "@/lib/proofs/versioning";

export const PROOF_REQUIREMENTS = [
  "pending",
  "required",
  "not_required",
  "not_applicable",
] as const;

export type ProofRequirement = (typeof PROOF_REQUIREMENTS)[number];

export const PROOF_REQUIREMENT_LABELS: Record<ProofRequirement, string> = {
  pending: "Awaiting decision",
  required: "Proof required",
  not_required: "No proof required",
  not_applicable: "Not applicable",
};

export type ManifestItemProofStatus =
  | "not_applicable"
  | "pending_decision"
  | "no_proof"
  | "revision_preparing"
  | "preparing"
  | "awaiting_approval"
  | "changes_requested"
  | "approved"
  | "not_required";

export const MANIFEST_ITEM_PROOF_STATUS_LABELS: Record<
  ManifestItemProofStatus,
  string
> = {
  not_applicable: "Proof not applicable",
  pending_decision: "Proof requirement not set",
  no_proof: "Proof required — not linked yet",
  revision_preparing: "Proof revision being prepared",
  preparing: "Proof being prepared",
  awaiting_approval: "Awaiting customer approval",
  changes_requested: "Changes requested",
  approved: "Proof approved",
  not_required: "Proof not required",
};

export type ProofRecordForItemCoverage = {
  id: string;
  proof_lineage_id: string;
  status: string;
  version_number: number;
};

export function isActiveManifestItem(
  item: Pick<
    ManifestItemRecord,
    "deleted_at" | "combined_into_item_id" | "production_requirement_status"
  >
) {
  if (item.deleted_at || item.combined_into_item_id) {
    return false;
  }

  return item.production_requirement_status === "required";
}

export function defaultProofRequirementForItemName(itemName: string): ProofRequirement {
  if (isLikelyNonPrintLine(itemName)) {
    return "not_applicable";
  }

  return "required";
}

export function defaultProofRequirementForNewItem(
  itemName: string,
  productionRequirementStatus: string
): ProofRequirement | null {
  if (productionRequirementStatus !== "required") {
    return "not_applicable";
  }

  return defaultProofRequirementForItemName(itemName);
}

export function normalizeProofRequirement(
  value: string | null | undefined
): ProofRequirement | null {
  if (!value) {
    return null;
  }

  return PROOF_REQUIREMENTS.includes(value as ProofRequirement)
    ? (value as ProofRequirement)
    : null;
}

/** Active production items where staff can set a proof requirement. */
export function isProofableManifestItem(
  item: Pick<
    ManifestItemRecord,
    | "deleted_at"
    | "combined_into_item_id"
    | "production_requirement_status"
    | "proof_requirement"
  >
) {
  if (!isActiveManifestItem(item)) {
    return false;
  }

  const requirement = normalizeProofRequirement(item.proof_requirement ?? null);
  return requirement !== "not_applicable";
}

export function isItemProofRequirementPending(
  item: Pick<ManifestItemRecord, "proof_requirement"> & {
    deleted_at?: string | null;
    combined_into_item_id?: string | null;
    production_requirement_status?: string;
  }
) {
  if (!isProofableManifestItem(item as ManifestItemRecord)) {
    return false;
  }

  return normalizeProofRequirement(item.proof_requirement ?? null) === "pending";
}

export function isItemProofRequired(
  item: Pick<
    ManifestItemRecord,
    | "proof_requirement"
    | "deleted_at"
    | "combined_into_item_id"
    | "production_requirement_status"
  >
) {
  if (!isActiveManifestItem(item)) {
    return false;
  }

  return normalizeProofRequirement(item.proof_requirement ?? null) === "required";
}

export function isItemProofRequirementSatisfied(
  item: Pick<
    ManifestItemRecord,
    | "id"
    | "proof_requirement"
    | "deleted_at"
    | "combined_into_item_id"
    | "production_requirement_status"
  >
) {
  if (!isActiveManifestItem(item)) {
    return true;
  }

  const requirement = normalizeProofRequirement(item.proof_requirement ?? null);

  if (!requirement || requirement === "not_applicable" || requirement === "not_required") {
    return true;
  }

  if (requirement === "pending") {
    return false;
  }

  return false;
}

export function getProofRequiredManifestItems(items: ManifestItemRecord[]) {
  return items.filter(isItemProofRequired);
}

export function getPendingProofRequirementItems(items: ManifestItemRecord[]) {
  return items.filter(isItemProofRequirementPending);
}

export function getProofableManifestItems(items: ManifestItemRecord[]) {
  return items.filter(isProofableManifestItem);
}

export function deriveJobProofRequiredFromManifest(items: ManifestItemRecord[]) {
  return getProofRequiredManifestItems(items).length > 0;
}

export function hasUnresolvedProofRequirementDecisions(items: ManifestItemRecord[]) {
  return getPendingProofRequirementItems(items).length > 0;
}

export function summarizeProofRequirementProgress(items: ManifestItemRecord[]) {
  const requiredItems = getProofRequiredManifestItems(items);
  const pendingItems = getPendingProofRequirementItems(items);

  return {
    requiredCount: requiredItems.length,
    pendingCount: pendingItems.length,
    proofableCount: getProofableManifestItems(items).length,
  };
}

function getLineageIdsForManifestItem(
  itemId: string,
  proofs: ProofRecordForItemCoverage[],
  links: Array<{ proof_id: string; production_item_id: string }>
) {
  const lineageIds = new Set<string>();

  for (const link of links) {
    if (link.production_item_id !== itemId) {
      continue;
    }

    const proof = proofs.find((entry) => entry.id === link.proof_id);
    if (proof) {
      lineageIds.add(proof.proof_lineage_id);
    }
  }

  return lineageIds;
}

export function getManifestItemProofStatus(
  item: Pick<
    ManifestItemRecord,
    | "id"
    | "proof_requirement"
    | "deleted_at"
    | "combined_into_item_id"
    | "production_requirement_status"
  >,
  proofs: ProofRecordForItemCoverage[],
  links: Array<{ proof_id: string; production_item_id: string }>
): ManifestItemProofStatus {
  if (!isActiveManifestItem(item)) {
    return "not_applicable";
  }

  const requirement = normalizeProofRequirement(item.proof_requirement ?? null);

  if (requirement === "not_applicable") {
    return "not_applicable";
  }

  if (requirement === "not_required") {
    return "not_required";
  }

  if (requirement === "pending") {
    return "pending_decision";
  }

  const lineageIds = getLineageIdsForManifestItem(item.id, proofs, links);

  if (lineageIds.size === 0) {
    return "no_proof";
  }

  const currentProofs = [...lineageIds]
    .map((lineageId) =>
      getCurrentProofInLineage(proofs.filter((proof) => proof.proof_lineage_id === lineageId))
    )
    .filter(Boolean);

  if (currentProofs.some((proof) => proof!.status === "approved")) {
    return "approved";
  }

  if (currentProofs.some((proof) => proof!.status === "changes_requested")) {
    return "changes_requested";
  }

  if (currentProofs.some((proof) => proof!.status === "sent" || proof!.status === "viewed")) {
    return "awaiting_approval";
  }

  const hasHistoricApproval = proofs.some(
    (proof) => lineageIds.has(proof.proof_lineage_id) && proof.status === "approved"
  );
  const hasInProgressCurrent = currentProofs.some((proof) =>
    ["draft", "internal_review", "ready_to_send"].includes(proof!.status)
  );

  if (hasHistoricApproval && hasInProgressCurrent) {
    return "revision_preparing";
  }

  return "preparing";
}

export function isManifestItemProofApproved(
  item: Pick<
    ManifestItemRecord,
    | "id"
    | "proof_requirement"
    | "deleted_at"
    | "combined_into_item_id"
    | "production_requirement_status"
  >,
  proofs: ProofRecordForItemCoverage[],
  links: Array<{ proof_id: string; production_item_id: string }>
) {
  if (!isItemProofRequired(item)) {
    return true;
  }

  return getManifestItemProofStatus(item, proofs, links) === "approved";
}

export function buildManifestItemProofCoverage(
  manifestItems: ManifestItemRecord[],
  proofs: ProofRecordForItemCoverage[],
  links: Array<{ proof_id: string; production_item_id: string }>
) {
  const proofRequiredItems = getProofRequiredManifestItems(manifestItems);
  const pendingDecisionItems = getPendingProofRequirementItems(manifestItems);
  const satisfiedItemIds = new Set<string>();

  for (const item of proofRequiredItems) {
    if (isManifestItemProofApproved(item, proofs, links)) {
      satisfiedItemIds.add(item.id);
    }
  }

  const proofRequired = proofRequiredItems.length > 0;

  return {
    proofRequired,
    proofRequiredItemIds: new Set(proofRequiredItems.map((item) => item.id)),
    satisfiedItemIds,
    pendingDecisionItemIds: new Set(pendingDecisionItems.map((item) => item.id)),
    coveredItemIds: satisfiedItemIds,
    hasWholeJobApprovedCoverage: false,
    requiredCount: proofRequiredItems.length,
    satisfiedCount: satisfiedItemIds.size,
    pendingDecisionCount: pendingDecisionItems.length,
  };
}

export type ManifestItemProofCoverage = ReturnType<typeof buildManifestItemProofCoverage>;

export function findUncoveredProofRequiredItemReferences(
  manifestItems: ManifestItemRecord[],
  coverage: ManifestItemProofCoverage
) {
  return manifestItems
    .filter(isItemProofRequired)
    .filter((item) => !coverage.satisfiedItemIds.has(item.id))
    .map((item) => item.item_reference ?? item.item_name);
}

export function findPendingProofRequirementReferences(items: ManifestItemRecord[]) {
  return getPendingProofRequirementItems(items).map(
    (item) => item.item_reference ?? item.item_name
  );
}
