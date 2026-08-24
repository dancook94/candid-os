import type { JobProofView } from "@/lib/proofs/types";
import {
  getCustomerProofFile,
  getSourceArtworkFile,
  hasGeneratedCustomerProof,
} from "@/lib/proofs/proof-files";
import {
  getCurrentProofInLineage,
  groupProofsByLineage,
} from "@/lib/proofs/versioning";

const EDITABLE_DRAFT_STATUSES = ["draft", "internal_review"] as const;

function isEditableDraft(proof: Pick<JobProofView, "status">) {
  return EDITABLE_DRAFT_STATUSES.includes(
    proof.status as (typeof EDITABLE_DRAFT_STATUSES)[number]
  );
}

export type EditableDraftProof = JobProofView & {
  lineageTitle: string;
};

export type DraftProgressSummary = {
  sourceArtwork: string;
  preflight: string;
  generatedPdf: string;
  generatedPdfFileName: string | null;
  generatedPdfStatus: "not_generated" | "current" | "needs_regeneration";
  generatedPdfStale: boolean;
  internalReview: string;
};

const PREFLIGHT_STATUS_LABELS: Record<string, string> = {
  pass: "Complete",
  warning: "Complete with warnings",
  manual_review: "Complete — manual review",
  fail: "Issues found",
};

function normalizeDropboxPath(path: string) {
  return path.trim().toLowerCase().replace(/\\/g, "/");
}

export function findEditableDraftProofs(proofs: JobProofView[]): EditableDraftProof[] {
  const drafts: EditableDraftProof[] = [];

  for (const lineageProofs of groupProofsByLineage(proofs)) {
    const current = getCurrentProofInLineage(lineageProofs);
    if (!current || !isEditableDraft(current)) {
      continue;
    }

    drafts.push({
      ...current,
      lineageTitle: current.title,
    });
  }

  return drafts.sort((left, right) => right.version_number - left.version_number);
}

export function isGeneratedPdfStale(proof: JobProofView): boolean {
  const hasGenerated =
    hasGeneratedCustomerProof(proof.files ?? []) || Boolean(proof.brandedPdfGeneratedAt);

  if (!hasGenerated) {
    return false;
  }

  const source = getSourceArtworkFile(proof.files ?? []);
  const preflight = proof.preflightSummary;

  if (!source?.dropbox_path) {
    return true;
  }

  if (preflight?.generatedAt && source.created_at) {
    if (new Date(source.created_at).getTime() > new Date(preflight.generatedAt).getTime()) {
      return true;
    }
  }

  if (
    preflight?.sourceDropboxPath &&
    normalizeDropboxPath(preflight.sourceDropboxPath) !==
      normalizeDropboxPath(source.dropbox_path)
  ) {
    return true;
  }

  if (preflight?.updatedAt && preflight.generatedAt) {
    if (new Date(preflight.updatedAt).getTime() > new Date(preflight.generatedAt).getTime()) {
      return true;
    }
  }

  const fingerprint = preflight?.generatedProofFingerprint;
  if (fingerprint) {
    if (
      fingerprint.sourceDropboxPath &&
      normalizeDropboxPath(fingerprint.sourceDropboxPath) !==
        normalizeDropboxPath(source.dropbox_path)
    ) {
      return true;
    }

    if (
      fingerprint.sourceContentHash &&
      source.content_hash &&
      fingerprint.sourceContentHash !== source.content_hash
    ) {
      return true;
    }

    const currentCustomerMessage = proof.customer_message ?? null;
    if (fingerprint.customerMessage !== currentCustomerMessage) {
      return true;
    }
  }

  return false;
}

export function getDraftProgressSummary(proof: JobProofView): DraftProgressSummary {
  const source = getSourceArtworkFile(proof.files ?? []);
  const customerProof = getCustomerProofFile(proof.files ?? []);
  const generatedPdfStale = isGeneratedPdfStale(proof);
  const preflightStatus = proof.preflightSummary?.overallStatus ?? null;

  let preflightLabel = "Not run";
  if (preflightStatus) {
    preflightLabel = PREFLIGHT_STATUS_LABELS[preflightStatus] ?? preflightStatus;
  } else if (source) {
    preflightLabel = "Not run";
  } else {
    preflightLabel = "Waiting for source artwork";
  }

  const generatedPdfFileName = customerProof?.file_name ?? null;
  let generatedPdfStatus: DraftProgressSummary["generatedPdfStatus"] = "not_generated";
  let generatedPdfLabel = "Not generated";

  if (generatedPdfFileName) {
    generatedPdfStatus = generatedPdfStale ? "needs_regeneration" : "current";
    generatedPdfLabel = generatedPdfStale
      ? `${generatedPdfFileName} · Needs regeneration`
      : `${generatedPdfFileName} · Current`;
  } else if (proof.brandedPdfGeneratedAt) {
    generatedPdfStatus = generatedPdfStale ? "needs_regeneration" : "current";
    generatedPdfLabel = generatedPdfStale
      ? "Generated PDF on record · Needs regeneration"
      : "Generated PDF on record · Current";
  }

  let internalReviewLabel = "Not submitted";
  if (proof.status === "internal_review") {
    internalReviewLabel = "Submitted";
  } else if (proof.internal_review_at) {
    internalReviewLabel = "Submitted";
  } else if (proof.status === "ready_to_send") {
    internalReviewLabel = "Approved for sending";
  }

  return {
    sourceArtwork: source?.file_name ? `Attached (${source.file_name})` : "Not attached",
    preflight: preflightLabel,
    generatedPdf: generatedPdfLabel,
    generatedPdfFileName,
    generatedPdfStatus,
    generatedPdfStale,
    internalReview: internalReviewLabel,
  };
}

export function hasValidGeneratedCustomerProof(proof: JobProofView): boolean {
  if (!hasGeneratedCustomerProof(proof.files ?? []) && !proof.brandedPdfGeneratedAt) {
    return false;
  }

  return !isGeneratedPdfStale(proof);
}
