import { DropboxError, isDropboxConfigured } from "@/lib/dropbox/client";
import { WORKING_FILES_SUBFOLDER } from "@/lib/dropbox/job-folders";
import {
  appendDropboxUploadSession,
  finishDropboxUploadSession,
  startDropboxUploadSession,
} from "@/lib/dropbox/upload-session";
import {
  getJobArtworkChunkBytes,
  getJobArtworkMaxBytes,
} from "@/lib/jobs/constants";
import {
  getArtworkExtension,
  sanitizeArtworkFileName,
} from "@/lib/jobs/file-validation";
import { ProofError } from "@/lib/proofs/errors";
import {
  assertDropboxPathInJobSubfolder,
  resolveDropboxFileMetadata,
} from "@/lib/proofs/dropbox";
import {
  isProofSourceAttachExtension,
  proofSourceAttachExtensionError,
} from "@/lib/proofs/source-artwork-formats";
import {
  joinDropboxPathWithFile,
  normalizeDropboxApiPath,
  buildJobSubfolderPath,
} from "@/lib/proofs/file-validation";
type StaffUploadJobContext = {
  id: string;
  dropbox_folder_path: string | null;
};

function sanitizeStaffProofUploadFileName(fileName: string) {
  const trimmed = fileName.trim();
  const extension = getArtworkExtension(trimmed);
  const base = sanitizeArtworkFileName(
    extension ? trimmed.slice(0, trimmed.length - extension.length - 1) : trimmed
  );

  return extension ? `${base}.${extension}` : base;
}

export function validateStaffProofSourceUploadInput(input: {
  fileName: string;
  mimeType?: string | null;
  fileSizeBytes: number;
}) {
  if (!input.fileName.trim()) {
    return "File name is required.";
  }

  if (!Number.isFinite(input.fileSizeBytes) || input.fileSizeBytes <= 0) {
    return "Empty files cannot be uploaded.";
  }

  const maxBytes = getJobArtworkMaxBytes();
  if (input.fileSizeBytes > maxBytes) {
    return `File exceeds the maximum upload size of ${Math.round(maxBytes / (1024 * 1024))} MB.`;
  }

  if (!isProofSourceAttachExtension(input.fileName)) {
    return proofSourceAttachExtensionError(input.fileName);
  }

  return null;
}

export function buildStaffProofWorkingFilePath(
  dropboxFolderPath: string,
  fileName: string
) {
  const workingFolderPath = buildJobSubfolderPath(
    dropboxFolderPath,
    WORKING_FILES_SUBFOLDER
  );
  const safeFileName = sanitizeStaffProofUploadFileName(fileName);
  return joinDropboxPathWithFile(workingFolderPath, safeFileName);
}

export async function startStaffProofSourceUpload(
  job: StaffUploadJobContext,
  input: {
    fileName: string;
    mimeType?: string | null;
    fileSizeBytes: number;
  }
) {
  if (!isDropboxConfigured()) {
    throw new ProofError("Dropbox integration is not configured.", 503);
  }

  if (!job.dropbox_folder_path) {
    throw new ProofError("No Dropbox folder is linked to this job yet.", 409);
  }

  const validationError = validateStaffProofSourceUploadInput(input);
  if (validationError) {
    throw new ProofError(validationError, 400);
  }

  const dropboxPath = buildStaffProofWorkingFilePath(
    normalizeDropboxApiPath(job.dropbox_folder_path),
    input.fileName
  );

  assertDropboxPathInJobSubfolder(
    dropboxPath,
    job.dropbox_folder_path,
    WORKING_FILES_SUBFOLDER
  );

  let sessionId: string;
  try {
    const session = await startDropboxUploadSession();
    sessionId = session.session_id;
  } catch (error) {
    throw new ProofError(
      error instanceof DropboxError
        ? `Dropbox upload failed: ${error.message}`
        : "Dropbox upload failed.",
      502
    );
  }

  if (!sessionId) {
    throw new ProofError("Dropbox upload failed.", 502);
  }

  return {
    sessionId,
    dropboxPath,
    fileName: sanitizeStaffProofUploadFileName(input.fileName),
    chunkSizeBytes: getJobArtworkChunkBytes(),
    maxBytes: getJobArtworkMaxBytes(),
  };
}

export async function appendStaffProofSourceUploadChunk(input: {
  job: StaffUploadJobContext;
  sessionId: string;
  dropboxPath: string;
  offset: number;
  chunk: ArrayBuffer;
}) {
  if (!input.job.dropbox_folder_path) {
    throw new ProofError("No Dropbox folder is linked to this job yet.", 409);
  }

  assertDropboxPathInJobSubfolder(
    input.dropboxPath,
    input.job.dropbox_folder_path,
    WORKING_FILES_SUBFOLDER
  );

  if (!input.sessionId.trim()) {
    throw new ProofError("Upload session not found.", 404);
  }

  if (input.offset < 0 || input.chunk.byteLength <= 0) {
    throw new ProofError("Invalid upload chunk.", 400);
  }

  try {
    await appendDropboxUploadSession(
      input.sessionId,
      input.offset,
      input.chunk
    );
  } catch (error) {
    throw new ProofError(
      error instanceof DropboxError
        ? `Dropbox upload failed: ${error.message}`
        : "Dropbox upload failed.",
      502
    );
  }

  return {
    uploadedBytes: input.offset + input.chunk.byteLength,
  };
}

export async function finishStaffProofSourceUpload({
    job,
    sessionId,
    dropboxPath,
    fileName,
    mimeType,
    fileSizeBytes,
  }: {
    job: StaffUploadJobContext;
    sessionId: string;
    dropboxPath: string;
    fileName: string;
    mimeType?: string | null;
    fileSizeBytes: number;
  }
) {
  if (!job.dropbox_folder_path) {
    throw new ProofError("No Dropbox folder is linked to this job yet.", 409);
  }

  assertDropboxPathInJobSubfolder(
    dropboxPath,
    job.dropbox_folder_path,
    WORKING_FILES_SUBFOLDER
  );

  const validationError = validateStaffProofSourceUploadInput({
    fileName,
    mimeType,
    fileSizeBytes,
  });

  if (validationError) {
    throw new ProofError(validationError, 400);
  }

  let dropboxMetadata;
  try {
    dropboxMetadata = await finishDropboxUploadSession({
      sessionId,
      totalSize: fileSizeBytes,
      dropboxPath,
    });
  } catch (error) {
    throw new ProofError(
      error instanceof DropboxError
        ? `Dropbox upload failed: ${error.message}`
        : "Dropbox upload failed.",
      502
    );
  }

  const verified = await resolveDropboxFileMetadata(
    dropboxMetadata.path_lower ?? dropboxMetadata.path_display
  );

  return {
    ok: true as const,
    fileName: verified.name,
    dropboxPath: verified.path_lower ?? verified.path_display,
    dropboxFileId: verified.id,
    dropboxRevision: verified.rev,
    fileSizeBytes: verified.size,
    contentHash: verified.content_hash ?? null,
  };
}
