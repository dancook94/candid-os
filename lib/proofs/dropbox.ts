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
  CUSTOMER_UPLOAD_SUBFOLDER,
  PROOFS_SUBFOLDER,
  sanitizeDropboxPathSegment,
  WORKING_FILES_SUBFOLDER,
} from "@/lib/dropbox/job-folders";
import { ProofError } from "@/lib/proofs/errors";
import {
  buildJobSubfolderPath,
  isPathUnderSubfolder,
  normalizeDropboxPath,
} from "@/lib/proofs/file-validation";
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

export function resolveProofSourceFolderPathForJob(
  origin: ProofArtworkOrigin,
  dropboxFolderPath: string | null,
  jobReference: string,
  projectName: string
) {
  if (!dropboxFolderPath) {
    return null;
  }

  switch (origin) {
    case "customer_uploaded":
    case "existing_repeat":
      return `${dropboxFolderPath}/${CUSTOMER_UPLOAD_SUBFOLDER}`;
    case "candid_created":
      return `${dropboxFolderPath}/${WORKING_FILES_SUBFOLDER}`;
    default:
      return `${dropboxFolderPath}/${CUSTOMER_UPLOAD_SUBFOLDER}`;
  }
}

export function resolveProofsFolderPathForJob(dropboxFolderPath: string | null) {
  if (!dropboxFolderPath) {
    return null;
  }

  return buildJobSubfolderPath(dropboxFolderPath, PROOFS_SUBFOLDER);
}

export function resolveProofsFolderPath(
  dropboxFolderPath: string | null,
  jobReference: string,
  projectName: string
) {
  if (dropboxFolderPath) {
    return resolveProofsFolderPathForJob(dropboxFolderPath);
  }

  return buildProofsFolderPath(jobReference, projectName);
}

export function resolveProofsFolderPathOrThrow(
  dropboxFolderPath: string | null,
  jobReference: string,
  projectName: string
) {
  const path = resolveProofsFolderPath(dropboxFolderPath, jobReference, projectName);
  if (!path) {
    throw new ProofError("Proofs folder path is unavailable.", 500);
  }
  return path;
}

export function isPathInProofsFolder(
  filePath: string,
  dropboxFolderPath: string | null,
  jobReference: string,
  projectName: string
) {
  const proofsFolder = resolveProofsFolderPath(
    dropboxFolderPath,
    jobReference,
    projectName
  );
  if (!proofsFolder) {
    return false;
  }
  const prefix = normalizeDropboxPath(proofsFolder);
  return normalizeDropboxPath(filePath).startsWith(`${prefix}/`);
}

export async function listProofSourceDropboxFiles(
  origin: ProofArtworkOrigin,
  {
    dropboxFolderPath,
    jobReference,
    projectName,
  }: {
    dropboxFolderPath?: string | null;
    jobReference: string;
    projectName: string;
  }
) {
  if (!dropboxFolderPath || !isDropboxConfigured()) {
    return [];
  }

  const folderPath = resolveProofSourceFolderPathForJob(
    origin,
    dropboxFolderPath,
    jobReference,
    projectName
  );

  if (!folderPath) {
    return [];
  }

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

export async function listProofFolderDropboxFiles(
  dropboxFolderPath: string | null
) {
  if (!dropboxFolderPath || !isDropboxConfigured()) {
    return [];
  }

  const folderPath = resolveProofsFolderPathForJob(dropboxFolderPath);

  if (!folderPath) {
    return [];
  }

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
  return `${base}-Proof-v${versionNumber}.${extension.replace(/^\./, "")}`;
}

export function buildProofUploadTargetFileName({
  itemReference,
  proofReference,
  versionNumber,
  extension,
}: {
  itemReference: string | null;
  proofReference: string;
  versionNumber: number;
  extension: string;
}) {
  const safeExtension = extension.replace(/^\./, "");

  if (itemReference) {
    return buildProofDropboxFileName(itemReference, versionNumber, safeExtension);
  }

  const safeReference = sanitizeDropboxPathSegment(proofReference);
  return `${safeReference}.${safeExtension}`;
}

export async function copyProofFileToProofsFolder({
  sourcePath,
  proofsFolderPath,
  versionNumber,
  itemReference,
  proofReference,
  fileName,
}: {
  sourcePath: string;
  proofsFolderPath: string;
  versionNumber: number;
  itemReference: string | null;
  proofReference: string;
  fileName?: string | null;
}) {
  if (!isDropboxConfigured()) {
    throw new ProofError("Dropbox is not configured.", 503);
  }

  const extension = fileName?.split(".").pop() ?? "pdf";
  const targetName =
    fileName?.trim() ||
    buildProofUploadTargetFileName({
      itemReference,
      proofReference,
      versionNumber,
      extension,
    });
  const targetPath = `${proofsFolderPath.replace(/\/+$/, "")}/${sanitizeDropboxPathSegment(targetName)}`;

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
    contentHash: metadata.content_hash ?? null,
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

export function assertDropboxPathInJobSubfolder(
  dropboxPath: string,
  dropboxFolderPath: string,
  subfolder: string
) {
  if (
    !isPathUnderSubfolder(dropboxPath, dropboxFolderPath, subfolder)
  ) {
    throw new ProofError("File is not in the expected job Dropbox folder.", 400);
  }
}
