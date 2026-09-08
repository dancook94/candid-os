import { getFileExtension } from "@/lib/proofs/file-validation";

/** Staff may upload/attach these as proof source artwork. */
export const PROOF_SOURCE_ATTACH_EXTENSIONS = [
  "pdf",
  "ai",
  "jpg",
  "jpeg",
  "png",
] as const;

export type ProofSourceAttachExtension =
  (typeof PROOF_SOURCE_ATTACH_EXTENSIONS)[number];

/** Extensions the branded proof generator can attempt to process. */
export const PROOF_GENERATION_COMPATIBLE_EXTENSIONS = [
  "pdf",
  "ai",
  "jpg",
  "jpeg",
  "png",
] as const;

/** Visible in Dropbox discovery but not valid proof source artwork. */
export const PROOF_SOURCE_DISCOVERY_BLOCKED_EXTENSIONS = [
  "eps",
  "psd",
  "indd",
  "tif",
  "tiff",
  "svg",
  "webp",
  "gif",
  "zip",
] as const;

export const PROOF_SOURCE_UPLOAD_ACCEPT = PROOF_SOURCE_ATTACH_EXTENSIONS.map(
  (extension) => `.${extension}`
).join(",");

export function normalizeProofSourceExtension(fileName: string) {
  return getFileExtension(fileName);
}

export function isProofSourceAttachExtension(fileName: string) {
  const extension = normalizeProofSourceExtension(fileName);
  return PROOF_SOURCE_ATTACH_EXTENSIONS.includes(
    extension as ProofSourceAttachExtension
  );
}

export function isProofGenerationCompatibleExtension(fileName: string) {
  const extension = normalizeProofSourceExtension(fileName);
  return PROOF_GENERATION_COMPATIBLE_EXTENSIONS.includes(
    extension as (typeof PROOF_GENERATION_COMPATIBLE_EXTENSIONS)[number]
  );
}

export function isProofSourceDiscoveryBlockedExtension(fileName: string) {
  const extension = normalizeProofSourceExtension(fileName);
  return PROOF_SOURCE_DISCOVERY_BLOCKED_EXTENSIONS.includes(
    extension as (typeof PROOF_SOURCE_DISCOVERY_BLOCKED_EXTENSIONS)[number]
  );
}

export function proofSourceAttachExtensionError(fileName: string) {
  if (isProofSourceAttachExtension(fileName)) {
    return null;
  }

  if (isProofSourceDiscoveryBlockedExtension(fileName)) {
    return "This file type cannot be attached as proof source artwork. Export a PDF or PDF-compatible Illustrator file, or use JPG/PNG.";
  }

  return "Only PDF, PDF-compatible AI, JPG, and PNG files can be attached as proof source artwork.";
}

export function proofGenerationCompatibilityLabel(fileName: string) {
  const extension = normalizeProofSourceExtension(fileName);

  if (extension === "ai") {
    return "Illustrator — proof generation requires a PDF-compatible .ai save";
  }

  if (isProofGenerationCompatibleExtension(fileName)) {
    return null;
  }

  if (extension === "eps") {
    return "EPS — not supported for automated proof generation";
  }

  if (isProofSourceDiscoveryBlockedExtension(fileName)) {
    return `${extension.toUpperCase()} — not supported for proof source artwork`;
  }

  return "Not supported for automated proof generation";
}
