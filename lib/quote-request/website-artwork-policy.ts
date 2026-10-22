import { createHmac, timingSafeEqual } from "node:crypto";

import { sanitizeDropboxPathSegment } from "@/lib/dropbox/job-folders";
import {
  JOB_ARTWORK_ALLOWED_EXTENSIONS,
  JOB_ARTWORK_BLOCKED_EXTENSIONS,
} from "@/lib/jobs/constants";
import { sanitizeArtworkFileName } from "@/lib/jobs/file-validation";

export const WEBSITE_ARTWORK_MAX_BYTES = 500 * 1024 * 1024;
export const WEBSITE_ARTWORK_CHUNK_BYTES = 4 * 1024 * 1024;
export const WEBSITE_ARTWORK_MAX_FILES = 10;
export const WEBSITE_ARTWORK_GRANT_MS = 30 * 60 * 1000;
export const WEBSITE_ARTWORK_DEFAULT_ROOT = "/Candid Website Enquiries";

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

const SUBMISSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export class WebsiteArtworkError extends Error {
  status: number;
  committedOffset?: number;
  retryAfterSeconds?: number;

  constructor(message: string, status: number, committedOffset?: number) {
    super(message);
    this.name = "WebsiteArtworkError";
    this.status = status;
    this.committedOffset = committedOffset;
  }
}

export function websiteEnquiryRoot() {
  const configured = process.env.DROPBOX_WEBSITE_ENQUIRY_ROOT?.trim();
  const root = configured || WEBSITE_ARTWORK_DEFAULT_ROOT;

  if (!root.startsWith("/") || root.includes("..") || root.includes("//")) {
    throw new WebsiteArtworkError("Artwork storage is not configured.", 503);
  }

  return root.replace(/\/+$/, "");
}

function safeSegment(value: string, fallback: string) {
  const cleaned = sanitizeDropboxPathSegment(value)
    .replace(/\.\./g, "-")
    .replace(/[^A-Za-z0-9 ._-]/g, "")
    .trim()
    .slice(0, 40);

  if (!/[A-Za-z0-9]/.test(cleaned)) {
    return fallback;
  }

  return cleaned;
}

export function sanitizeWebsiteArtworkFileName(fileName: string) {
  const cleaned = sanitizeArtworkFileName(fileName)
    .replace(/\.\./g, ".")
    .replace(/^\.+/, "")
    .slice(0, 120);
  const safe = /^[A-Za-z0-9]/.test(cleaned) ? cleaned : `file-${cleaned}`.slice(0, 120);

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(safe)) {
    return "artwork";
  }

  return safe;
}

export function enquiryYear(createdAt: Date) {
  const year = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
  }).format(createdAt);

  if (!/^\d{4}$/.test(year)) {
    throw new WebsiteArtworkError("The enquiry date could not be used.", 500);
  }

  return year;
}

export function buildWebsiteEnquiryFolderPath({
  quoteRequestId,
  createdAt,
  companyName,
  projectName,
  root = websiteEnquiryRoot(),
}: {
  quoteRequestId: string;
  createdAt: Date;
  companyName: string | null;
  projectName: string | null;
  root?: string;
}) {
  const company = safeSegment(companyName?.trim() || "No company", "No company");
  const project = safeSegment(projectName?.trim() || "Project", "Project");
  const folder = `${quoteRequestId} - ${company} - ${project}`;
  const path = `${root}/${enquiryYear(createdAt)}/${folder}`;

  if (!isInsideEnquiryRoot(path, root) || path.includes("..")) {
    throw new WebsiteArtworkError("The artwork folder could not be created.", 500);
  }

  return path;
}

export function normalizeDropboxPath(path: string) {
  if (!path.startsWith("/")) {
    return null;
  }

  const parts: string[] = [];

  for (const part of path.split("/")) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      return null;
    }

    parts.push(part);
  }

  return `/${parts.join("/")}`.toLowerCase();
}

export function isInsideEnquiryRoot(path: string, root: string) {
  const normalized = normalizeDropboxPath(path);
  const normalizedRoot = normalizeDropboxPath(root);

  if (!normalized || !normalizedRoot) {
    return false;
  }

  return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`);
}

function extensionOf(fileName: string) {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop()?.toLowerCase() ?? "" : "";
}

export function validateWebsiteArtworkFile({
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

  if (!Number.isInteger(fileSizeBytes) || fileSizeBytes <= 0) {
    return "Empty files cannot be uploaded.";
  }

  if (fileSizeBytes > WEBSITE_ARTWORK_MAX_BYTES) {
    return "File exceeds the maximum upload size of 500 MB.";
  }

  const extension = extensionOf(fileName);

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
    const allowed = MIME_BY_EXTENSION[extension] ?? [];

    if (
      allowed.length > 0 &&
      !allowed.some((value) => mimeType.toLowerCase().startsWith(value))
    ) {
      return "File content type does not match the selected file extension.";
    }
  }

  return null;
}

export function assertSubmissionId(value: unknown) {
  if (typeof value !== "string" || !SUBMISSION_ID_PATTERN.test(value)) {
    throw new WebsiteArtworkError("Submission id is invalid.", 400);
  }

  return value;
}

type GrantPayload = {
  v: 1;
  qr: string;
  file: string;
  ops: Array<"chunk" | "finish">;
  exp: number;
  max: number;
};

export function issueArtworkGrant({
  quoteRequestId,
  fileId,
  secret,
  now,
  maxBytes = WEBSITE_ARTWORK_MAX_BYTES,
}: {
  quoteRequestId: string;
  fileId: string;
  secret: string;
  now: Date;
  maxBytes?: number;
}) {
  const expiresAt = now.getTime() + WEBSITE_ARTWORK_GRANT_MS;
  const payload: GrantPayload = {
    v: 1,
    qr: quoteRequestId,
    file: fileId,
    ops: ["chunk", "finish"],
    exp: expiresAt,
    max: maxBytes,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");

  return {
    grant: `${body}.${signature}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function readArtworkGrant(
  token: string,
  secret: string | null,
  now: Date
): GrantPayload | "invalid" | "expired" {
  if (!secret || !token.includes(".")) {
    return "invalid";
  }

  const dot = token.indexOf(".");
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  if (!body || !signature || signature.includes(".")) {
    return "invalid";
  }

  const actual = createHmac("sha256", secret).update(body).digest();
  const supplied = Buffer.from(signature, "base64url");

  if (supplied.length !== actual.length || !timingSafeEqual(actual, supplied)) {
    return "invalid";
  }

  let payload: GrantPayload;

  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as GrantPayload;
  } catch {
    return "invalid";
  }

  if (
    payload.v !== 1 ||
    typeof payload.qr !== "string" ||
    typeof payload.file !== "string" ||
    typeof payload.exp !== "number" ||
    typeof payload.max !== "number" ||
    !Array.isArray(payload.ops)
  ) {
    return "invalid";
  }

  if (payload.exp <= now.getTime()) {
    return "expired";
  }

  return payload;
}

export function grantAllows(
  payload: GrantPayload,
  {
    quoteRequestId,
    fileId,
    operation,
    fileSizeBytes,
  }: {
    quoteRequestId: string;
    fileId: string;
    operation: "chunk" | "finish";
    fileSizeBytes: number;
  }
) {
  return (
    payload.qr === quoteRequestId &&
    payload.file === fileId &&
    payload.ops.includes(operation) &&
    fileSizeBytes <= payload.max &&
    fileSizeBytes <= WEBSITE_ARTWORK_MAX_BYTES
  );
}
