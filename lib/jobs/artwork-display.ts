import type { JobFileRecord } from "@/lib/jobs/types";

export function resolveArtworkUploadedAt(
  file: Pick<JobFileRecord, "uploaded_at" | "created_at">
) {
  return file.uploaded_at ?? file.created_at ?? null;
}

export function formatArtworkUploadedAt(dateString: string | null | undefined) {
  if (!dateString) {
    return "—";
  }

  const date = new Date(dateString);
  const datePart = date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const timePart = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return `${datePart}, ${timePart}`;
}

export function formatArtworkCustomerNote(note: string | null | undefined) {
  const trimmed = note?.trim();
  return trimmed ? trimmed : "No note";
}

export function resolveArtworkUploadedAtIso(
  dropboxServerModified: string | null | undefined
) {
  if (dropboxServerModified) {
    const parsed = new Date(dropboxServerModified);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}
