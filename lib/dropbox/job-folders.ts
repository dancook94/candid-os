import {
  createDropboxFolder,
  getDropboxRootFolder,
  type DropboxFolderMetadata,
} from "@/lib/dropbox/client";

export const JOB_DROPBOX_SUBFOLDERS = [
  "01 Customer Artwork",
  "02 Working Files",
  "03 Proofs",
  "04 Production Files",
] as const;

export const CUSTOMER_UPLOAD_SUBFOLDER = "01 Customer Artwork";

export function sanitizeDropboxPathSegment(value: string) {
  return value
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function buildJobDropboxFolderName(jobReference: string, projectName: string) {
  const safeReference = sanitizeDropboxPathSegment(jobReference);
  const safeProject = sanitizeDropboxPathSegment(projectName);
  return `${safeReference} - ${safeProject}`;
}

export function buildJobDropboxRootPath(jobReference: string, projectName: string) {
  const root = getDropboxRootFolder();
  const folderName = buildJobDropboxFolderName(jobReference, projectName);
  return `${root}/${folderName}`;
}

export function buildCustomerArtworkFolderPath(
  jobReference: string,
  projectName: string
) {
  return `${buildJobDropboxRootPath(jobReference, projectName)}/${CUSTOMER_UPLOAD_SUBFOLDER}`;
}

export async function ensureJobDropboxFolders({
  jobReference,
  projectName,
}: {
  jobReference: string;
  projectName: string;
}) {
  const rootPath = buildJobDropboxRootPath(jobReference, projectName);
  const rootFolder = await createDropboxFolder(rootPath);

  const subfolders: DropboxFolderMetadata[] = [];

  for (const subfolder of JOB_DROPBOX_SUBFOLDERS) {
    const created = await createDropboxFolder(`${rootPath}/${subfolder}`);
    subfolders.push(created.metadata);
  }

  return {
    rootPath,
    rootFolderId: rootFolder.metadata.id,
    customerArtworkPath: `${rootPath}/${CUSTOMER_UPLOAD_SUBFOLDER}`,
    subfolders,
  };
}
