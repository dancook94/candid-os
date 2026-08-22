import {
  copyDropboxFile,
  getDropboxMetadata,
  isDropboxConfigured,
  listDropboxFolderFiles,
} from "@/lib/dropbox/client";
import {
  buildCustomerArtworkFolderPath,
  buildProofsFolderPath,
  buildWorkingFilesFolderPath,
  sanitizeDropboxPathSegment,
} from "@/lib/dropbox/job-folders";
import { ProofError } from "@/lib/proofs/errors";
import type { ProofArtworkOrigin } from "@/lib/proofs/constants";

export function resolveProofSourceFolderPath(
  origin: ProofArtworkOrigin,
  jobReference: string,
  projectName: string
) {
  switch (origin) {
    case "customer_uploaded":
    case "existing_repeat":
      return buildCustomerArtworkFolderPath(jobReference, projectName);
    case "candid_created":
      return buildWorkingFilesFolderPath(jobReference, projectName);
    default:
      return buildCustomerArtworkFolderPath(jobReference, projectName);
  }
}

export async function listProofSourceDropboxFiles(
  origin: ProofArtworkOrigin,
  jobReference: string,
  projectName: string
) {
  if (!isDropboxConfigured()) {
    return [];
  }

  const folderPath = resolveProofSourceFolderPath(origin, jobReference, projectName);

  try {
    const files = await listDropboxFolderFiles(folderPath);
    return files.map((file) => ({
      id: file.id,
      name: file.name,
      path: file.path_lower ?? file.path_display,
      size: file.size,
      rev: file.rev,
    }));
  } catch {
    return [];
  }
}

export function buildProofDropboxFileName(
  itemReference: string | null,
  versionNumber: number,
  extension = "pdf"
) {
  const base = itemReference
    ? sanitizeDropboxPathSegment(itemReference)
    : "Proof";
  return `${base} Proof v${versionNumber}.${extension.replace(/^\./, "")}`;
}

export async function copyProofFileToProofsFolder({
  sourcePath,
  jobReference,
  projectName,
  versionNumber,
  itemReference,
  fileName,
}: {
  sourcePath: string;
  jobReference: string;
  projectName: string;
  versionNumber: number;
  itemReference: string | null;
  fileName?: string | null;
}) {
  if (!isDropboxConfigured()) {
    throw new ProofError("Dropbox is not configured.", 503);
  }

  const proofsFolder = buildProofsFolderPath(jobReference, projectName);
  const extension = fileName?.split(".").pop() ?? "pdf";
  const targetName =
    fileName?.trim() ||
    buildProofDropboxFileName(itemReference, versionNumber, extension);
  const targetPath = `${proofsFolder}/${sanitizeDropboxPathSegment(targetName)}`;

  const metadata = await copyDropboxFile({
    fromPath: sourcePath,
    toPath: targetPath,
  });

  return {
    dropboxFileId: metadata.id,
    dropboxPath: metadata.path_lower ?? metadata.path_display,
    dropboxRevision: metadata.rev,
    fileName: metadata.name,
    fileSizeBytes: metadata.size,
  };
}

export async function resolveDropboxFileMetadata(path: string) {
  if (!isDropboxConfigured()) {
    throw new ProofError("Dropbox is not configured.", 503);
  }

  const { metadata } = await getDropboxMetadata(path);

  if (!metadata || !("rev" in metadata)) {
    throw new ProofError("Dropbox file not found.", 404);
  }

  return metadata;
}
