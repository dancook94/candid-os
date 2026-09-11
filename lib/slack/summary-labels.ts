import { getCustomerArtworkStatusLabel } from "@/lib/notifications/artwork-copy";
import type { ProofWorkflowStatus } from "@/lib/proofs/constants";
import { PROOF_WORKFLOW_STATUS_LABELS } from "@/lib/proofs/constants";
import {
  JOB_PRODUCTION_BOARD_STAGE_LABELS,
  type JobProductionBoardStage,
} from "@/lib/production/job-board-constants";
import type { JobArtworkSource, JobStatus } from "@/lib/jobs/types";

export function formatSlackJobArtworkLabel(input: {
  artworkSource: JobArtworkSource | null | undefined;
  jobStatus: JobStatus | string | null | undefined;
}) {
  return getCustomerArtworkStatusLabel({
    artworkSource: input.artworkSource ?? undefined,
    jobStatus: (input.jobStatus as JobStatus | null) ?? null,
  });
}

export function formatSlackJobProofLabel(input: {
  proofRequired: boolean | null | undefined;
  proofWorkflowStatus: string | null | undefined;
}) {
  if (input.proofRequired === false) {
    return "Not required";
  }

  const status = (input.proofWorkflowStatus ?? "no_proof").trim();

  switch (status) {
    case "not_required":
      return "Not required";
    case "no_proof":
      return "Required";
    case "draft":
    case "internal_review":
    case "ready_to_send":
      return "Awaiting proof";
    case "awaiting_customer":
      return "Proof sent";
    case "changes_requested":
      return "Changes requested";
    case "approved":
      return "Approved";
    default:
      return (
        PROOF_WORKFLOW_STATUS_LABELS[status as ProofWorkflowStatus] ?? status
      );
  }
}

export function formatSlackProductionBoardStageLabel(
  stage: JobProductionBoardStage | string | null | undefined
) {
  const key = (stage ?? "accepted_quotes") as JobProductionBoardStage;
  return JOB_PRODUCTION_BOARD_STAGE_LABELS[key] ?? String(stage ?? "Accepted Quotes");
}

export function formatSlackFulfilmentLabel(
  fulfilmentMethod: string | null | undefined
) {
  const normalized = fulfilmentMethod?.trim().toLowerCase();

  if (normalized === "delivery") {
    return "Delivery";
  }

  if (normalized === "collection") {
    return "Collection";
  }

  return null;
}

export function formatSlackProductionDeadlineLabel(
  requiredDate: string | null | undefined,
  requiredTimeLabel: string | null | undefined
) {
  if (!requiredDate?.trim()) {
    return "Not set";
  }

  const dateLabel = new Date(`${requiredDate.trim()}T12:00:00`).toLocaleDateString(
    "en-GB",
    {
      weekday: "short",
      day: "numeric",
      month: "short",
    }
  );

  if (requiredTimeLabel?.trim()) {
    return `${dateLabel} · ${requiredTimeLabel.trim()}`;
  }

  return dateLabel;
}

/** Only genuine Dropbox web URLs — never derive from folder paths. */
export function resolveSlackDropboxWebUrl(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);

    if (url.protocol !== "https:") {
      return null;
    }

    if (!url.hostname.endsWith("dropbox.com")) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}
