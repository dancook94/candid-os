import type { JobProofView } from "@/lib/proofs/types";

/** Statuses where staff can start the next version from the current proof in a lineage. */
export const REVISABLE_PROOF_STATUSES = [
  "changes_requested",
  "approved",
  "sent",
  "viewed",
] as const;

export type RevisableProofStatus = (typeof REVISABLE_PROOF_STATUSES)[number];

const IN_PROGRESS_PROOF_STATUSES = ["draft", "internal_review", "ready_to_send"] as const;

export function manifestItemSetsMatch(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const normalizedLeft = [...left].sort();
  const normalizedRight = [...right].sort();

  return normalizedLeft.every((id, index) => id === normalizedRight[index]);
}

export function highestProofVersionInLineage<
  T extends { version_number: number; proof_lineage_id: string },
>(proofs: T[], proofLineageId: string) {
  return proofs
    .filter((proof) => proof.proof_lineage_id === proofLineageId)
    .reduce((max, proof) => Math.max(max, proof.version_number), 0);
}

export function nextProofVersionInLineage<
  T extends { version_number: number; proof_lineage_id: string },
>(proofs: T[], proofLineageId: string) {
  return highestProofVersionInLineage(proofs, proofLineageId) + 1;
}

export function groupProofsByLineage<
  T extends { proof_lineage_id: string; version_number: number; created_at: string },
>(proofs: T[]) {
  const groups = new Map<string, T[]>();

  for (const proof of proofs) {
    const existing = groups.get(proof.proof_lineage_id) ?? [];
    existing.push(proof);
    groups.set(proof.proof_lineage_id, existing);
  }

  return [...groups.values()].map((lineageProofs) =>
    [...lineageProofs].sort((left, right) => right.version_number - left.version_number)
  );
}

export function isRevisableProofStatus(status: string): status is RevisableProofStatus {
  return REVISABLE_PROOF_STATUSES.includes(status as RevisableProofStatus);
}

export function proofSupportsRevision(proof: {
  status: string;
  brandedPdfGeneratedAt?: string | null;
  hasGeneratedCustomerProof?: boolean;
}) {
  if (isRevisableProofStatus(proof.status)) {
    return true;
  }

  if (!["draft", "internal_review", "ready_to_send"].includes(proof.status)) {
    return false;
  }

  return Boolean(proof.brandedPdfGeneratedAt) || Boolean(proof.hasGeneratedCustomerProof);
}

export function hasInProgressProof(proofs: Array<{ status: string }>) {
  return proofs.some((proof) =>
    IN_PROGRESS_PROOF_STATUSES.includes(
      proof.status as (typeof IN_PROGRESS_PROOF_STATUSES)[number]
    )
  );
}

export function getInProgressProof(
  proofs: Array<{ id: string; status: string; version_number: number }>
) {
  return (
    proofs.find((proof) =>
      IN_PROGRESS_PROOF_STATUSES.includes(
        proof.status as (typeof IN_PROGRESS_PROOF_STATUSES)[number]
      )
    ) ?? null
  );
}

/** Highest non-archived proof version within one lineage. */
export function getCurrentProofInLineage<
  T extends { status: string; version_number: number },
>(proofs: T[]): T | null {
  const active = proofs.filter(
    (proof) => !["superseded", "cancelled"].includes(proof.status)
  );

  if (!active.length) {
    return null;
  }

  return [...active].sort((left, right) => right.version_number - left.version_number)[0];
}

/** Highest non-archived proof version driving admin/customer "current" context. */
export function getCurrentProofRecord<
  T extends { status: string; version_number: number; proof_lineage_id: string },
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

    return right.proof_lineage_id.localeCompare(left.proof_lineage_id);
  })[0];
}

export function canCreateRevisedProof(
  sourceProof: Pick<
    JobProofView,
    "status" | "proof_lineage_id" | "version_number" | "brandedPdfGeneratedAt"
  > & {
    hasGeneratedCustomerProof?: boolean;
  },
  proofs: Array<
    Pick<JobProofView, "id" | "status" | "version_number" | "proof_lineage_id">
  >
) {
  if (["superseded", "cancelled"].includes(sourceProof.status)) {
    return false;
  }

  if (
    !proofSupportsRevision({
      status: sourceProof.status,
      brandedPdfGeneratedAt: sourceProof.brandedPdfGeneratedAt,
      hasGeneratedCustomerProof: sourceProof.hasGeneratedCustomerProof,
    })
  ) {
    return false;
  }

  const lineageProofs = proofs.filter(
    (proof) => proof.proof_lineage_id === sourceProof.proof_lineage_id
  );

  if (lineageProofs.length === 0) {
    return false;
  }

  if (getInProgressProof(lineageProofs)) {
    return false;
  }

  const latestInLineage = getCurrentProofInLineage(lineageProofs);
  return latestInLineage?.version_number === sourceProof.version_number;
}

export function getLineageRevisionSourceProof<
  T extends Pick<
    JobProofView,
    | "id"
    | "status"
    | "proof_lineage_id"
    | "version_number"
    | "brandedPdfGeneratedAt"
    | "files"
  >,
>(lineageProofs: T[], proofs: T[]) {
  const currentInLineage = getCurrentProofInLineage(lineageProofs);
  if (!currentInLineage) {
    return null;
  }

  const revisionContext = {
    status: currentInLineage.status,
    proof_lineage_id: currentInLineage.proof_lineage_id,
    version_number: currentInLineage.version_number,
    brandedPdfGeneratedAt: currentInLineage.brandedPdfGeneratedAt,
    hasGeneratedCustomerProof: hasGeneratedCustomerProofForRevision(currentInLineage),
  };

  return canCreateRevisedProof(revisionContext, proofs) ? currentInLineage : null;
}

function hasGeneratedCustomerProofForRevision(
  proof: Pick<JobProofView, "files" | "brandedPdfGeneratedAt">
) {
  if (proof.brandedPdfGeneratedAt) {
    return true;
  }

  return proof.files.some((file) => file.file_role === "customer_proof" && file.dropbox_path);
}

export function revisionCreatesNewImmutableVersion(status: string) {
  return ["sent", "viewed", "approved", "changes_requested"].includes(status);
}

export function formatProofHistoryEntry(
  proof: Pick<JobProofView, "title" | "version_number" | "status">,
  statusLabel: string
) {
  return `${proof.title} · v${proof.version_number} — ${statusLabel}`;
}

export function buildProofReference(jobReference: string, versionNumber: number) {
  return `${jobReference} Proof v${versionNumber}`;
}

export function isLatestActionableProofInLineage<
  T extends {
    id: string;
    status: string;
    version_number: number;
    proof_lineage_id: string;
  },
>(proof: T, proofs: T[]) {
  if (!["sent", "viewed"].includes(proof.status)) {
    return false;
  }

  const lineageProofs = proofs.filter(
    (candidate) => candidate.proof_lineage_id === proof.proof_lineage_id
  );
  const latestActionable = [...lineageProofs]
    .filter((candidate) => ["sent", "viewed"].includes(candidate.status))
    .sort((left, right) => right.version_number - left.version_number)[0];

  return latestActionable?.id === proof.id;
}

export function getLatestActionableProofsPerLineage<
  T extends {
    id: string;
    status: string;
    version_number: number;
    proof_lineage_id: string;
  },
>(proofs: T[]) {
  const latestByLineage = new Map<string, T>();

  for (const proof of proofs) {
    if (!["sent", "viewed"].includes(proof.status)) {
      continue;
    }

    const existing = latestByLineage.get(proof.proof_lineage_id);
    if (!existing || proof.version_number > existing.version_number) {
      latestByLineage.set(proof.proof_lineage_id, proof);
    }
  }

  return [...latestByLineage.values()];
}

export function formatLineageManifestSummary(
  items: Array<{ item_reference: string | null; item_name: string }>
) {
  if (!items.length) {
    return "No linked items";
  }

  return items
    .map((item) => item.item_reference ?? item.item_name)
    .join(", ");
}
