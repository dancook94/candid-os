import type { JobProofView } from "@/lib/proofs/types";

/** Statuses that allow staff to create the next proof version from an existing one. */
export const REVISABLE_PROOF_STATUSES = ["changes_requested", "approved"] as const;

export type RevisableProofStatus = (typeof REVISABLE_PROOF_STATUSES)[number];

const IN_PROGRESS_PROOF_STATUSES = ["draft", "internal_review", "ready_to_send"] as const;

export function isRevisableProofStatus(status: string): status is RevisableProofStatus {
  return REVISABLE_PROOF_STATUSES.includes(status as RevisableProofStatus);
}

export function hasInProgressProof(proofs: Array<{ status: string }>) {
  return proofs.some((proof) =>
    IN_PROGRESS_PROOF_STATUSES.includes(
      proof.status as (typeof IN_PROGRESS_PROOF_STATUSES)[number]
    )
  );
}

export function getInProgressProof(proofs: Array<{ id: string; status: string; version_number: number }>) {
  return (
    proofs.find((proof) =>
      IN_PROGRESS_PROOF_STATUSES.includes(
        proof.status as (typeof IN_PROGRESS_PROOF_STATUSES)[number]
      )
    ) ?? null
  );
}

/** Highest non-archived proof version driving admin/customer "current" context. */
export function getCurrentProofRecord<T extends { status: string; version_number: number }>(
  proofs: T[]
): T | null {
  const active = proofs.filter(
    (proof) => !["superseded", "cancelled"].includes(proof.status)
  );

  if (!active.length) {
    return null;
  }

  return [...active].sort((left, right) => right.version_number - left.version_number)[0];
}

export function canCreateRevisedProof(
  sourceProof: Pick<JobProofView, "status">,
  proofs: Array<Pick<JobProofView, "id" | "status" | "version_number">>
) {
  if (!isRevisableProofStatus(sourceProof.status)) {
    return false;
  }

  return !hasInProgressProof(proofs);
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
