import {
  JOB_ARTWORK_ALLOWED_EXTENSIONS,
  JOB_ARTWORK_BLOCKED_EXTENSIONS,
  getJobArtworkMaxBytes,
} from "@/lib/jobs/constants";

const MIME_BY_EXTENSION: Record<string, string[]> = {
  pdf: ["application/pdf"],
  ai: ["application/postscript", "application/illustrator", "application/pdf"],
  eps: ["application/postscript", "application/eps", "image/eps"],
  svg: ["image/svg+xml"],
  psd: ["image/vnd.adobe.photoshop", "application/x-photoshop"],
  tif: ["image/tiff"],
  tiff: ["image/tiff"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  zip: ["application/zip", "application/x-zip-compressed"],
};

function getExtension(fileName: string) {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop()?.toLowerCase() ?? "" : "";
}

export function sanitizeArtworkFileName(fileName: string) {
  const cleaned = fileName
    .replace(/[/\\]/g, "_")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .trim();

  return cleaned || "artwork";
}

export function getArtworkBaseName(fileName: string) {
  const extension = getExtension(fileName);
  if (!extension) {
    return sanitizeArtworkFileName(fileName);
  }

  const base = fileName.slice(0, fileName.length - extension.length - 1);
  return sanitizeArtworkFileName(base || "artwork");
}

export function validateArtworkUploadInput({
  fileName,
  mimeType,
  fileSizeBytes,
}: {
  fileName: string;
  mimeType?: string | null;
  fileSizeBytes: number;
}) {
  if (!fileName.trim()) {
    return "File name is required.";
  }

  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    return "Empty files cannot be uploaded.";
  }

  const maxBytes = getJobArtworkMaxBytes();
  if (fileSizeBytes > maxBytes) {
    return `File exceeds the maximum upload size of ${Math.round(maxBytes / (1024 * 1024))} MB.`;
  }

  const extension = getExtension(fileName);

  if (
    JOB_ARTWORK_BLOCKED_EXTENSIONS.includes(
      extension as (typeof JOB_ARTWORK_BLOCKED_EXTENSIONS)[number]
    )
  ) {
    return "This file type is not allowed.";
  }

  if (
    !JOB_ARTWORK_ALLOWED_EXTENSIONS.includes(
      extension as (typeof JOB_ARTWORK_ALLOWED_EXTENSIONS)[number]
    )
  ) {
    return "File type not allowed. Upload PDF, AI, EPS, SVG, PSD, TIFF, JPG, PNG, or ZIP files.";
  }

  if (mimeType) {
    const allowedMimes = MIME_BY_EXTENSION[extension] ?? [];
    if (
      allowedMimes.length > 0 &&
      !allowedMimes.some((allowed) => mimeType.toLowerCase().startsWith(allowed))
    ) {
      return "File content type does not match the selected file extension.";
    }
  }

  return null;
}

export function buildVersionedArtworkFileName(
  originalFileName: string,
  versionNumber: number
) {
  const extension = getExtension(originalFileName);
  const base = getArtworkBaseName(originalFileName);

  if (versionNumber <= 1) {
    return extension ? `${base}.${extension}` : base;
  }

  return extension ? `${base}_v${versionNumber}.${extension}` : `${base}_v${versionNumber}`;
}

export function getArtworkExtension(fileName: string) {
  return getExtension(fileName);
}
