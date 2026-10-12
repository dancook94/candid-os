export type GmailMessagePart = {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailMessagePart[];
};

export type GmailAttachmentRef = {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size: number;
  kind: "pdf" | "image" | "other";
};

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/tiff",
]);

function attachmentKind(filename: string, mimeType: string): GmailAttachmentRef["kind"] {
  const name = filename.toLowerCase();
  const mime = mimeType.toLowerCase();

  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    return "pdf";
  }

  if (IMAGE_TYPES.has(mime) || /\.(?:jpe?g|png|gif|webp|tiff?)$/.test(name)) {
    return "image";
  }

  return "other";
}

export function collectAttachments(part: GmailMessagePart | null | undefined): GmailAttachmentRef[] {
  if (!part) {
    return [];
  }

  const nested = (part.parts ?? []).flatMap((child) => collectAttachments(child));
  const attachmentId = part.body?.attachmentId;

  if (!attachmentId) {
    return nested;
  }

  const filename = part.filename?.trim() || "attachment";
  const mimeType = part.mimeType?.trim() || "application/octet-stream";

  return [
    {
      filename,
      mimeType,
      attachmentId,
      size: part.body?.size ?? 0,
      kind: attachmentKind(filename, mimeType),
    },
    ...nested,
  ];
}

export function decodeGmailBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
}
