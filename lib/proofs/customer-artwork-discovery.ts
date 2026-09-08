import { normalizeDropboxApiPath } from "@/lib/proofs/file-validation";

export type DropboxListFile = {
  id: string;
  name: string;
  path: string;
  size: number;
};

export type JobFileDropboxMatch = {
  id: string;
  file_name: string;
  upload_status: string;
  dropbox_path_lower?: string | null;
};

export type CustomerArtworkDiscoveryFile = DropboxListFile & {
  jobFileId: string | null;
  portalUploaded: boolean;
};

function normalizePathForMatch(path: string) {
  return normalizeDropboxApiPath(path).toLowerCase();
}

export function findJobFileIdForDropboxPath(
  dropboxPath: string,
  jobFiles: JobFileDropboxMatch[]
) {
  const normalizedTarget = normalizePathForMatch(dropboxPath);

  const exact = jobFiles.find((file) => {
    if (file.upload_status !== "complete" || !file.dropbox_path_lower) {
      return false;
    }

    return normalizePathForMatch(file.dropbox_path_lower) === normalizedTarget;
  });

  if (exact) {
    return exact.id;
  }

  const fileName = normalizedTarget.split("/").pop();
  if (!fileName) {
    return null;
  }

  const byName = jobFiles.find(
    (file) =>
      file.upload_status === "complete" &&
      file.file_name.toLowerCase() === fileName
  );

  return byName?.id ?? null;
}

export function mergeCustomerArtworkDiscoveryFiles(
  dropboxFiles: DropboxListFile[],
  jobFiles: JobFileDropboxMatch[]
): CustomerArtworkDiscoveryFile[] {
  const completeJobFiles = jobFiles.filter(
    (file) => file.upload_status === "complete"
  );

  const mergedByPath = new Map<string, CustomerArtworkDiscoveryFile>();

  for (const file of dropboxFiles) {
    const jobFileId = findJobFileIdForDropboxPath(file.path, completeJobFiles);
    mergedByPath.set(normalizePathForMatch(file.path), {
      ...file,
      jobFileId,
      portalUploaded: Boolean(jobFileId),
    });
  }

  for (const jobFile of completeJobFiles) {
    if (!jobFile.dropbox_path_lower) {
      continue;
    }

    const normalizedPath = normalizePathForMatch(jobFile.dropbox_path_lower);
    if (mergedByPath.has(normalizedPath)) {
      continue;
    }

    mergedByPath.set(normalizedPath, {
      id: jobFile.id,
      name: jobFile.file_name,
      path: normalizeDropboxApiPath(jobFile.dropbox_path_lower),
      size: 0,
      jobFileId: jobFile.id,
      portalUploaded: true,
    });
  }

  return [...mergedByPath.values()].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
  );
}
