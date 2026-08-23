import {
  buildManifestItemProofCoverage,
  deriveJobProofRequiredFromManifest,
  findPendingProofRequirementReferences,
  getManifestItemProofStatus,
  hasUnresolvedProofRequirementDecisions,
  type ManifestItemProofStatus,
  type ProofRecordForItemCoverage,
} from "@/lib/manifest/proof-requirement";
import type { ManifestItemRecord } from "@/lib/manifest/types";
import type { CustomerProofStatus } from "@/lib/proofs/customer-state";
import { deriveCustomerProofState, type CustomerProofSummary } from "@/lib/proofs/customer-state";

export type JobProofSummary = {
  proofRequired: boolean;
  requirementsConfirmed: boolean;
  requiredItemCount: number;
  satisfiedItemCount: number;
  pendingDecisionCount: number;
  status: CustomerProofStatus;
  label: string;
  boardLabel: string;
  hasPendingDecisions: boolean;
};

export function deriveJobProofSummary({
  manifestItems,
  proofs,
  links,
  jobReference,
  projectName,
  jobId,
  proofRequirementsConfirmedAt,
  legacyProofRequired,
}: {
  manifestItems: ManifestItemRecord[];
  proofs: ProofRecordForItemCoverage[];
  links: Array<{ proof_id: string; production_item_id: string }>;
  jobReference: string;
  projectName: string;
  jobId: string;
  proofRequirementsConfirmedAt?: string | null;
  legacyProofRequired?: boolean | null;
}): JobProofSummary {
  const hasItemLevelData = manifestItems.some((item) => item.proof_requirement != null);
  const coverage = buildManifestItemProofCoverage(manifestItems, proofs, links);
  const proofRequired = hasItemLevelData
    ? deriveJobProofRequiredFromManifest(manifestItems)
    : legacyProofRequired !== false;
  const hasPendingDecisions = hasItemLevelData
    ? hasUnresolvedProofRequirementDecisions(manifestItems)
    : false;
  const requirementsConfirmed = hasItemLevelData
    ? Boolean(proofRequirementsConfirmedAt) && !hasPendingDecisions
    : true;

  const customerProofState = deriveCustomerProofState({
    proofRequired,
    proofs: proofs as CustomerProofSummary[],
    jobId,
    jobReference,
    projectName,
  });

  if (!hasItemLevelData) {
    return {
      proofRequired,
      requirementsConfirmed: true,
      requiredItemCount: coverage.requiredCount,
      satisfiedItemCount: coverage.satisfiedCount,
      pendingDecisionCount: coverage.pendingDecisionCount,
      status: customerProofState.status,
      label: customerProofState.label,
      boardLabel: customerProofState.label,
      hasPendingDecisions: false,
    };
  }

  if (!proofRequired && !hasPendingDecisions) {
    return {
      proofRequired: false,
      requirementsConfirmed,
      requiredItemCount: 0,
      satisfiedItemCount: 0,
      pendingDecisionCount: 0,
      status: "not_required",
      label: "Proof not required",
      boardLabel: "Proof: Not required",
      hasPendingDecisions: false,
    };
  }

  if (hasPendingDecisions) {
    const pendingRefs = findPendingProofRequirementReferences(manifestItems);
    return {
      proofRequired,
      requirementsConfirmed: false,
      requiredItemCount: coverage.requiredCount,
      satisfiedItemCount: coverage.satisfiedCount,
      pendingDecisionCount: coverage.pendingDecisionCount,
      status: "preparing",
      label: `Proof requirements incomplete (${pendingRefs.join(", ")})`,
      boardLabel: "Proof: Requirements incomplete",
      hasPendingDecisions: true,
    };
  }

  if (coverage.requiredCount === 0) {
    return {
      proofRequired: false,
      requirementsConfirmed,
      requiredItemCount: 0,
      satisfiedItemCount: 0,
      pendingDecisionCount: 0,
      status: "not_required",
      label: "Proof not required",
      boardLabel: "Proof: Not required",
      hasPendingDecisions: false,
    };
  }

  if (coverage.satisfiedCount === coverage.requiredCount) {
    return {
      proofRequired: true,
      requirementsConfirmed,
      requiredItemCount: coverage.requiredCount,
      satisfiedItemCount: coverage.satisfiedCount,
      pendingDecisionCount: 0,
      status: "approved",
      label: "Proof approved",
      boardLabel: "Proof: Approved",
      hasPendingDecisions: false,
    };
  }

  const itemStatuses = manifestItems
    .filter((item) => item.proof_requirement === "required")
    .map((item) => getManifestItemProofStatus(item, proofs, links));

  if (itemStatuses.some((status) => status === "changes_requested")) {
    return {
      proofRequired: true,
      requirementsConfirmed,
      requiredItemCount: coverage.requiredCount,
      satisfiedItemCount: coverage.satisfiedCount,
      pendingDecisionCount: 0,
      status: "changes_requested",
      label: "Changes requested",
      boardLabel: "Proof: Changes requested",
      hasPendingDecisions: false,
    };
  }

  if (itemStatuses.some((status) => status === "awaiting_approval")) {
    return {
      proofRequired: true,
      requirementsConfirmed,
      requiredItemCount: coverage.requiredCount,
      satisfiedItemCount: coverage.satisfiedCount,
      pendingDecisionCount: 0,
      status: "awaiting_approval",
      label: "Awaiting customer approval",
      boardLabel: "Proof: Awaiting customer approval",
      hasPendingDecisions: false,
    };
  }

  if (itemStatuses.some((status) => status === "revision_preparing")) {
    return {
      proofRequired: true,
      requirementsConfirmed,
      requiredItemCount: coverage.requiredCount,
      satisfiedItemCount: coverage.satisfiedCount,
      pendingDecisionCount: 0,
      status: "preparing",
      label: "Proof revision being prepared",
      boardLabel: `Proof: ${coverage.satisfiedCount} of ${coverage.requiredCount} required items approved`,
      hasPendingDecisions: false,
    };
  }

  return {
    proofRequired,
    requirementsConfirmed,
    requiredItemCount: coverage.requiredCount,
    satisfiedItemCount: coverage.satisfiedCount,
    pendingDecisionCount: 0,
    status: customerProofState.status,
    label: customerProofState.label,
    boardLabel: `Proof: ${coverage.satisfiedCount} of ${coverage.requiredCount} required items approved`,
    hasPendingDecisions: false,
  };
}

export function mapManifestItemProofStatusLabel(status: ManifestItemProofStatus) {
  switch (status) {
    case "approved":
      return "Proof approved";
    case "awaiting_approval":
      return "Awaiting approval";
    case "changes_requested":
      return "Changes requested";
    case "revision_preparing":
      return "Revision being prepared";
    case "not_required":
      return "No proof required";
    case "not_applicable":
      return "Not applicable";
    case "pending_decision":
      return "Awaiting requirement decision";
    default:
      return "Proof required";
  }
}
