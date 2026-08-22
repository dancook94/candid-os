import { getAdminArtworkSourceLabel } from "@/lib/jobs/artwork-source";
import type { JobArtworkSource, JobStatus } from "@/lib/jobs/types";

/** Customer-facing artwork status labels (portal wording). */
export function getCustomerArtworkStatusLabel(input: {
  artworkSource: JobArtworkSource | null | undefined;
  jobStatus?: JobStatus | null;
}): string {
  const source = input.artworkSource;

  if (source === "candid_creating") {
    return "Artwork in preparation";
  }

  if (source === "manual_receipt" || source === "portal_upload") {
    return "Artwork received";
  }

  if (source === "customer_pending" || input.jobStatus === "awaiting_artwork") {
    return "Awaiting artwork";
  }

  if (input.jobStatus === "artwork_in_preparation") {
    return "Artwork in preparation";
  }

  if (input.jobStatus === "artwork_received") {
    return "Artwork received";
  }

  return source ? getAdminArtworkSourceLabel(source) : "Awaiting artwork";
}

export function getCustomerArtworkUploadConfirmationParagraphs() {
  return [
    "Your artwork has been uploaded successfully. Our team will review the files and let you know if anything else is required.",
    "You can still upload additional files in Candid OS if needed.",
  ];
}

export function getArtworkReceivedManuallyParagraphs() {
  return [
    "We've received the artwork for your project and have linked it to your Candid OS job.",
  ];
}

export function getCandidCreatingArtworkParagraphs(proofRequired: boolean) {
  const paragraphs = [
    "Our artwork team is preparing the artwork for your project.",
  ];

  if (proofRequired) {
    paragraphs.push("You'll be notified when your proof is ready to review.");
  } else {
    paragraphs.push("Our team will prepare the artwork for production.");
  }

  return paragraphs;
}

export function resolveJobProofRequired(job: { proof_required?: boolean | null }) {
  return job.proof_required !== false;
}

export function formatArtworkFileSize(bytes: number | null | undefined) {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) {
    return "—";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const formatted =
    unitIndex === 0 ? String(Math.round(value)) : value.toFixed(value >= 10 ? 0 : 1);

  return `${formatted} ${units[unitIndex]}`;
}

export function summarizeArtworkFilenames(filenames: string[]) {
  if (filenames.length === 0) {
    return "Artwork uploaded";
  }

  if (filenames.length === 1) {
    return filenames[0];
  }

  return `${filenames[0]} (+${filenames.length - 1} more)`;
}
