import {
  PROOF_ATTACHABLE_STATUSES,
  REVISABLE_PROOF_STATUSES,
} from "@/lib/proofs/constants";
import type { JobProofView } from "@/lib/proofs/types";
import {
  getCustomerProofFile,
  getSourceArtworkFile,
  hasGeneratedCustomerProof,
  hasGeneratorEligibleSourceArtwork,
} from "@/lib/proofs/proof-files";

/** Statuses that block creating a newer revision in the same lineage. */
const REVISION_BLOCKING_STATUSES = ["draft", "internal_review"] as const;

const IMMUTABLE_REVISION_STATUSES = [
  "ready_to_send",
  "sent",
  "viewed",
  "approved",
  "changes_requested",
] as const;

type ProofWorkflowContext = Pick<
  JobProofView,
  "id" | "status" | "proof_lineage_id" | "version_number" | "brandedPdfGeneratedAt" | "files"
>;

type ProofLineageMember = Pick<
  JobProofView,
  "id" | "status" | "version_number" | "proof_lineage_id"
> & {
  created_at?: string;
};

export type ProofActionContext = {
  /** Pre-filtered proofs for this proof's lineage (avoids mismatched filters). */
  lineageProofs?: ProofLineageMember[];
  /** Caller already selected the lineage head for the current proof card. */
  assumeCurrentInLineage?: boolean;
};

export type ProofActions = {
  isCurrentInLineage: boolean;
  canEditAttachment: boolean;
  canReplaceAttachment: boolean;
  canRemoveAttachment: boolean;
  canGenerateBrandedPdf: boolean;
  canSendToCustomer: boolean;
  canCreateRevision: boolean;
  revisionHelpText: string | null;
};

function proofFiles(proof: Pick<JobProofView, "files">) {
  return proof.files ?? [];
}

export function getCurrentProofInLineage<
  T extends { status: string; version_number: number; created_at?: string },
>(proofs: T[]): T | null {
  const active = proofs.filter(
    (proof) => !["superseded", "cancelled"].includes(proof.status)
  );

  if (!active.length) {
    return null;
  }

  return [...active].sort((left, right) => {
    if (right.version_number !== left.version_number) {
      return right.version_number - left.version_number;
    }

    const leftCreated = left.created_at ?? "";
    const rightCreated = right.created_at ?? "";
    return rightCreated.localeCompare(leftCreated);
  })[0];
}

function proofHasGeneratedCustomerArtifactView(
  proof: Pick<JobProofView, "files" | "brandedPdfGeneratedAt">
) {
  if (proof.brandedPdfGeneratedAt) {
    return true;
  }

  return proofFiles(proof).some(
    (file) => file.file_role === "customer_proof" && Boolean(file.dropbox_path)
  );
}

function lineageProofsFor(
  proof: Pick<JobProofView, "proof_lineage_id">,
  allProofs: ProofLineageMember[],
  context?: ProofActionContext
) {
  return (
    context?.lineageProofs ??
    allProofs.filter(
      (candidate) => candidate.proof_lineage_id === proof.proof_lineage_id
    )
  );
}

export function hasBlockingRevisionInLineage(
  lineageProofs: ProofLineageMember[],
  sourceProof: Pick<JobProofView, "id" | "version_number">
) {
  return lineageProofs.some(
    (proof) =>
      proof.id !== sourceProof.id &&
      !["superseded", "cancelled"].includes(proof.status) &&
      REVISION_BLOCKING_STATUSES.includes(
        proof.status as (typeof REVISION_BLOCKING_STATUSES)[number]
      ) &&
      proof.version_number > sourceProof.version_number
  );
}

export function isCurrentProofInLineage(
  proof: ProofLineageMember,
  lineageProofs: ProofLineageMember[]
) {
  const current = getCurrentProofInLineage(lineageProofs);
  return current?.id === proof.id;
}

function proofSupportsNextRevision(proof: ProofWorkflowContext) {
  if (
    REVISABLE_PROOF_STATUSES.includes(
      proof.status as (typeof REVISABLE_PROOF_STATUSES)[number]
    )
  ) {
    return true;
  }

  return proofHasGeneratedCustomerArtifactView(proof);
}

/**
 * Core revision rule for a proof within its lineage (does not verify lineage head).
 */
export function canCreateNextRevision(
  proof: ProofWorkflowContext,
  lineageProofs: ProofLineageMember[]
): boolean {
  if (["superseded", "cancelled"].includes(proof.status)) {
    return false;
  }

  if (!lineageProofs.length) {
    return false;
  }

  if (hasBlockingRevisionInLineage(lineageProofs, proof)) {
    return false;
  }

  return proofSupportsNextRevision(proof);
}

/**
 * Whether staff can create the next proof version from this proof.
 * Single authoritative rule used by all admin proof UI.
 */
export function canCreateRevision(
  proof: ProofWorkflowContext,
  allProofs: ProofLineageMember[]
): boolean {
  const lineageProofs = lineageProofsFor(proof, allProofs);

  if (!isCurrentProofInLineage(proof, lineageProofs)) {
    return false;
  }

  return canCreateNextRevision(proof, lineageProofs);
}

/**
 * Central action policy for admin proof UI. Pass lineageProofs when rendering
 * a lineage card to avoid re-filtering the full job proof list.
 */
export function getProofActions(
  proof: ProofWorkflowContext,
  allProofs: ProofLineageMember[],
  context: ProofActionContext = {}
): ProofActions {
  const lineageProofs = lineageProofsFor(proof, allProofs, context);
  const isCurrentInLineage =
    context.assumeCurrentInLineage === true ||
    isCurrentProofInLineage(proof, lineageProofs);
  const canEditAttachment = canEditProofAttachment(proof);
  const canCreateRevisionAction =
    isCurrentInLineage && canCreateNextRevision(proof, lineageProofs);

  return {
    isCurrentInLineage,
    canEditAttachment,
    canReplaceAttachment: canEditAttachment,
    canRemoveAttachment: canEditAttachment,
    canGenerateBrandedPdf: canGenerateBrandedPdf(proof),
    canSendToCustomer: canSendProofToCustomer(proof as JobProofView),
    canCreateRevision: canCreateRevisionAction,
    revisionHelpText: canCreateRevisionAction ? revisionHelpText(proof) : null,
  };
}

export function canEditProofAttachment(
  proof: Pick<JobProofView, "status" | "files" | "brandedPdfGeneratedAt">
) {
  if (
    IMMUTABLE_REVISION_STATUSES.includes(
      proof.status as (typeof IMMUTABLE_REVISION_STATUSES)[number]
    )
  ) {
    return false;
  }

  if (!["draft", "internal_review"].includes(proof.status)) {
    return false;
  }

  return !proofHasGeneratedCustomerArtifactView(proof);
}

export function canGenerateBrandedPdf(proof: Pick<JobProofView, "status">) {
  return PROOF_ATTACHABLE_STATUSES.includes(
    proof.status as (typeof PROOF_ATTACHABLE_STATUSES)[number]
  );
}

export function canReplaceProofAttachment(
  proof: Pick<JobProofView, "status" | "files" | "brandedPdfGeneratedAt">
) {
  return canEditProofAttachment(proof);
}

export function canSendProofToCustomer(proof: JobProofView) {
  if (proof.status !== "ready_to_send") {
    return false;
  }

  const hasSourceArtwork = Boolean(getSourceArtworkFile(proofFiles(proof)));
  if (!hasSourceArtwork) {
    return true;
  }

  return hasGeneratedCustomerProof(proofFiles(proof));
}

export function requiresGeneratedCustomerProof(proof: JobProofView) {
  return hasGeneratorEligibleSourceArtwork(proofFiles(proof));
}

export function revisionHelpText(proof: Pick<JobProofView, "status" | "version_number">) {
  if (
    IMMUTABLE_REVISION_STATUSES.includes(
      proof.status as (typeof IMMUTABLE_REVISION_STATUSES)[number]
    )
  ) {
    return `Creates v${proof.version_number + 1} as a new draft. v${proof.version_number} and its files stay unchanged until the new version is sent.`;
  }

  return "Starts the next proof version in this series as a new draft. Attach revised artwork, run preflight, then generate the branded PDF.";
}

export function customerProofDownloadLabel(proof: JobProofView) {
  const customerProof = getCustomerProofFile(proofFiles(proof));
  return customerProof?.file_name ?? null;
}
