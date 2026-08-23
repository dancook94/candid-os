import {
  CUSTOMER_UPLOAD_SUBFOLDER,
  PROOFS_SUBFOLDER,
  WORKING_FILES_SUBFOLDER,
} from "@/lib/dropbox/job-folders";
import type { ProofFileLocationType } from "@/lib/proofs/constants";

export const PROOF_CUSTOMER_FACING_EXTENSIONS = [
  "pdf",
  "jpg",
  "jpeg",
  "png",
] as const;

export const PROOF_PRODUCTION_EXTENSIONS = [
  "ai",
  "eps",
  "psd",
  "indd",
  "tif",
  "tiff",
  "svg",
  "webp",
  "gif",
] as const;

/** Maximum size for admin proof PDF/image uploads to 03 Proofs (25 MB). */
export const PROOF_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

export const PROOF_UPLOAD_MAX_BYTES_LABEL = "25 MB";

export const PROOF_UPLOAD_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export function getFileExtension(fileName: string) {
  const match = fileName.trim().match(/\.([^.]+)$/);
  return match?.[1]?.toLowerCase() ?? "";
}

export function isCustomerFacingProofExtension(fileName: string) {
  const extension = getFileExtension(fileName);
  return PROOF_CUSTOMER_FACING_EXTENSIONS.includes(
    extension as (typeof PROOF_CUSTOMER_FACING_EXTENSIONS)[number]
  );
}

export function isProductionArtworkExtension(fileName: string) {
  const extension = getFileExtension(fileName);
  return PROOF_PRODUCTION_EXTENSIONS.includes(
    extension as (typeof PROOF_PRODUCTION_EXTENSIONS)[number]
  );
}

export function normalizeDropboxPath(path: string) {
  return path.replace(/\/+$/, "").toLowerCase();
}

/** Canonical Dropbox API path: leading slash, no duplicate segments, no trailing slash. */
export function normalizeDropboxApiPath(path: string) {
  let normalized = path.trim();
  if (!normalized) {
    return "/";
  }

  if (normalized.includes("%")) {
    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      // Keep the original path when decoding fails.
    }
  }

  normalized = normalized.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }

  if (normalized.length > 1) {
    normalized = normalized.replace(/\/+$/, "");
  }

  return normalized;
}

export function joinDropboxPath(...segments: string[]) {
  const parts: string[] = [];

  for (const segment of segments) {
    for (const piece of segment.split("/")) {
      const trimmed = piece.trim();
      if (trimmed) {
        parts.push(trimmed);
      }
    }
  }

  return normalizeDropboxApiPath(`/${parts.join("/")}`);
}

export function joinDropboxPathWithFile(folderPath: string, fileName: string) {
  const safeFileName = fileName.replace(/[/\\]+/g, "").trim();
  if (!safeFileName) {
    throw new Error("Dropbox file name is required.");
  }

  return joinDropboxPath(folderPath, safeFileName);
}

export function buildJobSubfolderPath(
  dropboxFolderPath: string,
  subfolder: string
) {
  return joinDropboxPath(dropboxFolderPath, subfolder);
}

export function isPathUnderSubfolder(
  filePath: string,
  dropboxFolderPath: string,
  subfolder: string
) {
  const prefix = normalizeDropboxPath(
    buildJobSubfolderPath(dropboxFolderPath, subfolder)
  );
  return normalizeDropboxPath(filePath).startsWith(`${prefix}/`);
}

export function resolveProofFileLocationType({
  dropboxPath,
  dropboxFolderPath,
  jobFileId,
}: {
  dropboxPath: string | null;
  dropboxFolderPath: string | null;
  jobFileId?: string | null;
}): ProofFileLocationType | null {
  if (jobFileId) {
    return "customer_artwork";
  }

  if (!dropboxPath || !dropboxFolderPath) {
    return null;
  }

  if (isPathUnderSubfolder(dropboxPath, dropboxFolderPath, PROOFS_SUBFOLDER)) {
    return "proofs_folder";
  }

  if (
    isPathUnderSubfolder(dropboxPath, dropboxFolderPath, WORKING_FILES_SUBFOLDER)
  ) {
    return "working_file";
  }

  if (
    isPathUnderSubfolder(dropboxPath, dropboxFolderPath, CUSTOMER_UPLOAD_SUBFOLDER)
  ) {
    return "customer_artwork";
  }

  return null;
}

export function isCustomerFacingProofAsset({
  fileName,
  dropboxPath,
  dropboxFolderPath,
  jobFileId,
}: {
  fileName: string;
  dropboxPath: string | null;
  dropboxFolderPath: string | null;
  jobFileId?: string | null;
}) {
  const location = resolveProofFileLocationType({
    dropboxPath,
    dropboxFolderPath,
    jobFileId,
  });

  if (location === "proofs_folder") {
    return true;
  }

  return isCustomerFacingProofExtension(fileName);
}

export function assertProofUploadFile(input: {
  fileName: string;
  mimeType: string | null;
  fileSizeBytes: number;
}) {
  const extension = getFileExtension(input.fileName);

  if (
    !PROOF_CUSTOMER_FACING_EXTENSIONS.includes(
      extension as (typeof PROOF_CUSTOMER_FACING_EXTENSIONS)[number]
    )
  ) {
    return "Only PDF, JPG, and PNG files can be uploaded as customer proofs.";
  }

  if (
    input.mimeType &&
    !PROOF_UPLOAD_ALLOWED_MIME_TYPES.includes(
      input.mimeType as (typeof PROOF_UPLOAD_ALLOWED_MIME_TYPES)[number]
    )
  ) {
    return "Unsupported file type. Upload a PDF, JPG, or PNG proof.";
  }

  if (input.fileSizeBytes <= 0) {
    return "File is empty.";
  }

  if (input.fileSizeBytes > PROOF_UPLOAD_MAX_BYTES) {
    return `Proof upload exceeds the ${PROOF_UPLOAD_MAX_BYTES_LABEL} limit.`;
  }

  return null;
}
