import { resolveJobProofRequired } from "@/lib/notifications/artwork-copy";
import { getLatestActionableProofsPerLineage } from "@/lib/proofs/versioning";
import type { JobProofView } from "@/lib/proofs/types";

/** True unless the job is explicitly marked proof_required = false. */
export function isJobProofRequired(job: { proof_required?: boolean | null }) {
  return resolveJobProofRequired(job);
}

export type CustomerProofSummary = Pick<
  JobProofView,
  | "id"
  | "status"
  | "version_number"
  | "proof_lineage_id"
  | "title"
  | "sent_at"
  | "changes_requested_comment"
>;

export const CUSTOMER_PROOF_STATUSES = [
  "not_required",
  "preparing",
  "awaiting_approval",
  "changes_requested",
  "approved",
] as const;

export type CustomerProofStatus = (typeof CUSTOMER_PROOF_STATUSES)[number];

export const CUSTOMER_PROOF_STATUS_LABELS: Record<CustomerProofStatus, string> = {
  not_required: "Proof not required",
  preparing: "Proof being prepared",
  awaiting_approval: "Proof awaiting approval",
  changes_requested: "Changes requested",
  approved: "Proof approved",
};

export type CustomerProofActionItem = {
  proofId: string;
  jobId: string;
  jobReference: string;
  projectName: string;
  proofTitle: string;
  version: number;
  sentAt: string | null;
  status: string;
  reviewUrl: string;
};

export type CustomerProofState = {
  status: CustomerProofStatus;
  label: string;
  requiresCustomerAction: boolean;
  activeProofId: string | null;
  version: number | null;
  awaitingApprovalCount: number;
  changesRequestedCount: number;
  changesRequestedComment: string | null;
  cardActionLabel: string | null;
  cardActionUrl: string | null;
  awaitingApprovalProofs: CustomerProofActionItem[];
};

const INTERNAL_PROOF_STATUSES = new Set([
  "draft",
  "internal_review",
  "ready_to_send",
  "cancelled",
]);

export function isCustomerVisibleProof(proof: Pick<CustomerProofSummary, "status">) {
  return !INTERNAL_PROOF_STATUSES.has(proof.status);
}

export function getCurrentCustomerProofs(proofs: CustomerProofSummary[]) {
  return proofs.filter(
    (proof) => isCustomerVisibleProof(proof) && proof.status !== "superseded"
  );
}

export function buildCustomerProofReviewUrl(jobId: string, proofId: string) {
  return `/jobs/${jobId}#proof-${proofId}`;
}

function pickPrimaryProof(
  proofs: CustomerProofSummary[],
  preferredStatuses: string[]
) {
  const matches = proofs
    .filter((proof) => preferredStatuses.includes(proof.status))
    .sort((left, right) => right.version_number - left.version_number);

  return matches[0] ?? null;
}

export function deriveCustomerProofState({
  proofRequired,
  proofs,
  jobId,
  jobReference,
  projectName,
}: {
  proofRequired: boolean;
  proofs: CustomerProofSummary[];
  jobId: string;
  jobReference: string;
  projectName: string;
}): CustomerProofState {
  if (!proofRequired) {
    return {
      status: "not_required",
      label: CUSTOMER_PROOF_STATUS_LABELS.not_required,
      requiresCustomerAction: false,
      activeProofId: null,
      version: null,
      awaitingApprovalCount: 0,
      changesRequestedCount: 0,
      changesRequestedComment: null,
      cardActionLabel: null,
      cardActionUrl: null,
      awaitingApprovalProofs: [],
    };
  }

  const currentProofs = getCurrentCustomerProofs(proofs);

  if (currentProofs.length === 0) {
    return {
      status: "preparing",
      label: CUSTOMER_PROOF_STATUS_LABELS.preparing,
      requiresCustomerAction: false,
      activeProofId: null,
      version: null,
      awaitingApprovalCount: 0,
      changesRequestedCount: 0,
      changesRequestedComment: null,
      cardActionLabel: null,
      cardActionUrl: null,
      awaitingApprovalProofs: [],
    };
  }

  const awaitingApproval = getLatestActionableProofsPerLineage(currentProofs);
  const changesRequested = currentProofs.filter(
    (proof) => proof.status === "changes_requested"
  );

  const awaitingApprovalProofs = awaitingApproval.map((proof) => ({
    proofId: proof.id,
    jobId,
    jobReference,
    projectName,
    proofTitle: proof.title,
    version: proof.version_number,
    sentAt: proof.sent_at,
    status: proof.status,
    reviewUrl: buildCustomerProofReviewUrl(jobId, proof.id),
  }));

  if (awaitingApproval.length > 0) {
    const primary = pickPrimaryProof(currentProofs, ["sent", "viewed"])!;
    const label =
      awaitingApproval.length > 1
        ? `${awaitingApproval.length} proofs awaiting approval`
        : CUSTOMER_PROOF_STATUS_LABELS.awaiting_approval;

    return {
      status: "awaiting_approval",
      label,
      requiresCustomerAction: true,
      activeProofId: primary.id,
      version: primary.version_number,
      awaitingApprovalCount: awaitingApproval.length,
      changesRequestedCount: changesRequested.length,
      changesRequestedComment: null,
      cardActionLabel: "Review proof",
      cardActionUrl: buildCustomerProofReviewUrl(jobId, primary.id),
      awaitingApprovalProofs,
    };
  }

  if (changesRequested.length > 0) {
    const primary = pickPrimaryProof(currentProofs, ["changes_requested"])!;

    return {
      status: "changes_requested",
      label: CUSTOMER_PROOF_STATUS_LABELS.changes_requested,
      requiresCustomerAction: false,
      activeProofId: primary.id,
      version: primary.version_number,
      awaitingApprovalCount: 0,
      changesRequestedCount: changesRequested.length,
      changesRequestedComment: primary.changes_requested_comment,
      cardActionLabel: null,
      cardActionUrl: null,
      awaitingApprovalProofs: [],
    };
  }

  if (currentProofs.every((proof) => proof.status === "approved")) {
    const primary = pickPrimaryProof(currentProofs, ["approved"])!;

    return {
      status: "approved",
      label: CUSTOMER_PROOF_STATUS_LABELS.approved,
      requiresCustomerAction: false,
      activeProofId: primary.id,
      version: primary.version_number,
      awaitingApprovalCount: 0,
      changesRequestedCount: 0,
      changesRequestedComment: null,
      cardActionLabel: null,
      cardActionUrl: null,
      awaitingApprovalProofs: [],
    };
  }

  const primary = [...currentProofs].sort(
    (left, right) => right.version_number - left.version_number
  )[0];

  return {
    status: "preparing",
    label: CUSTOMER_PROOF_STATUS_LABELS.preparing,
    requiresCustomerAction: false,
    activeProofId: primary?.id ?? null,
    version: primary?.version_number ?? null,
    awaitingApprovalCount: 0,
    changesRequestedCount: 0,
    changesRequestedComment: null,
    cardActionLabel: null,
    cardActionUrl: null,
    awaitingApprovalProofs: [],
  };
}

export function mapCustomerProofStatusToBadge(status: CustomerProofStatus) {
  switch (status) {
    case "approved":
      return "approved" as const;
    case "awaiting_approval":
      return "sent" as const;
    case "changes_requested":
      return "declined" as const;
    case "preparing":
      return "pending" as const;
    case "not_required":
      return "disabled" as const;
    default:
      return "disabled" as const;
  }
}

export function shouldShowCustomerProofActionLink(state: CustomerProofState) {
  return (
    state.requiresCustomerAction &&
    Boolean(state.cardActionUrl) &&
    Boolean(state.cardActionLabel)
  );
}
