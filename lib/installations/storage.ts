import {
  INSTALLATION_ALLOWED_DOCUMENT_TYPES,
  INSTALLATION_ALLOWED_PHOTO_TYPES,
  INSTALLATION_FILES_BUCKET,
  INSTALLATION_MAX_DOCUMENT_BYTES,
  INSTALLATION_MAX_PHOTO_BYTES,
  type InstallationDocumentKind,
  type InstallationPhotoPhase,
} from "@/lib/installations/constants";

export { INSTALLATION_FILES_BUCKET };

export function sanitizeInstallationFileName(name: string) {
  const base = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  return base.slice(0, 180) || "file";
}

export function buildInstallationDocumentPath(
  visitId: string,
  kind: InstallationDocumentKind,
  fileName: string
) {
  const stamp = Date.now();
  return `${visitId}/documents/${kind}/${stamp}-${sanitizeInstallationFileName(fileName)}`;
}

export function buildInstallationPhotoPath(
  visitId: string,
  phase: InstallationPhotoPhase,
  fileName: string
) {
  const stamp = Date.now();
  return `${visitId}/photos/${phase}/${stamp}-${sanitizeInstallationFileName(fileName)}`;
}

export function storageInstallationVisitIdFromPath(path: string): string | null {
  const segment = path.split("/")[0]?.trim();
  if (!segment || !/^[0-9a-f-]{36}$/i.test(segment)) {
    return null;
  }

  return segment;
}

const DOCUMENT_KIND_PATH_SEGMENTS = new Set([
  "rams",
  "artwork",
  "drawing",
  "installation_instructions",
  "other",
]);

export function isValidInstallationStoragePath(
  path: string,
  visitId?: string
): boolean {
  const parts = path.split("/");
  const pathVisitId = storageInstallationVisitIdFromPath(path);
  if (!pathVisitId) {
    return false;
  }

  if (visitId && pathVisitId !== visitId) {
    return false;
  }

  const kind = parts[1];
  const subkind = parts[2];
  if (kind === "documents") {
    return DOCUMENT_KIND_PATH_SEGMENTS.has(subkind ?? "");
  }

  if (kind === "photos") {
    return (
      subkind === "before" || subkind === "during" || subkind === "after"
    );
  }

  return false;
}

export function validateInstallationPhotoUpload(input: {
  mimeType: string;
  byteSize: number;
}) {
  if (!INSTALLATION_ALLOWED_PHOTO_TYPES.has(input.mimeType)) {
    return "Unsupported photo type.";
  }

  if (input.byteSize <= 0 || input.byteSize > INSTALLATION_MAX_PHOTO_BYTES) {
    return "Photo exceeds the size limit.";
  }

  return null;
}

export function validateInstallationDocumentUpload(input: {
  mimeType: string;
  byteSize: number;
}) {
  if (!INSTALLATION_ALLOWED_DOCUMENT_TYPES.has(input.mimeType)) {
    return "Unsupported document type.";
  }

  if (input.byteSize <= 0 || input.byteSize > INSTALLATION_MAX_DOCUMENT_BYTES) {
    return "Document exceeds the size limit.";
  }

  return null;
}
