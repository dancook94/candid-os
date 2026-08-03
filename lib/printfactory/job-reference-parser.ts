/**
 * Strict Candid job reference parser for Synology / PrintFactory paths.
 *
 * Valid format: J-{digits} e.g. J-4, J-1048
 * Matches buildJobReference() in lib/jobs/create-from-quote.ts
 */

const CANDID_JOB_REFERENCE_PATTERN = /\b(J-\d+)\b/gi;

export function normalizeJobReference(value: string) {
  const trimmed = value.trim().toUpperCase();
  const match = /^J-(\d+)$/.exec(trimmed);

  if (!match) {
    return null;
  }

  return `J-${match[1]}`;
}

export function extractJobReferencesFromText(text: string): string[] {
  if (!text?.trim()) {
    return [];
  }

  const found = new Set<string>();
  const matches = text.matchAll(CANDID_JOB_REFERENCE_PATTERN);

  for (const match of matches) {
    const normalized = normalizeJobReference(match[1]);

    if (normalized) {
      found.add(normalized);
    }
  }

  return [...found];
}

export function extractPrimaryJobReferenceFromPath(sourcePath: string): string | null {
  const references = extractJobReferencesFromText(sourcePath);

  if (references.length === 0) {
    return null;
  }

  if (references.length === 1) {
    return references[0];
  }

  // Multiple distinct references in one path — do not auto-pick.
  return null;
}

export function pathContainsConflictingJobReferences(sourcePath: string): boolean {
  return extractJobReferencesFromText(sourcePath).length > 1;
}

export function extractItemReferenceFromText(text: string): string | null {
  if (!text?.trim()) {
    return null;
  }

  // J-1048-01 or J-1048-A01
  const match = /\b(J-\d+-(?:A)?\d{2})\b/i.exec(text);

  if (!match) {
    return null;
  }

  const parts = match[1].toUpperCase().split("-");

  if (parts.length < 3) {
    return null;
  }

  const jobRef = normalizeJobReference(`${parts[0]}-${parts[1]}`);

  if (!jobRef) {
    return null;
  }

  const suffix = parts[2];

  if (/^A\d{2}$/.test(suffix)) {
    return `${jobRef}-A${suffix.slice(1)}`;
  }

  if (/^\d{2}$/.test(suffix)) {
    return `${jobRef}-${suffix}`;
  }

  return null;
}

export function extractFilenameFromPath(sourcePath: string): string | null {
  const normalized = sourcePath.replace(/\\/g, "/").trim();

  if (!normalized) {
    return null;
  }

  const segments = normalized.split("/").filter(Boolean);
  const last = segments.at(-1);

  return last?.trim() || null;
}
