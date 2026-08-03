/**
 * Strict Candid job reference parser for Synology / PrintFactory paths.
 *
 * Valid formats: J-1048, J1048 (word boundary), bare digits only in job-folder paths.
 * Matches buildJobReference() in lib/jobs/create-from-quote.ts
 */

const CANDID_JOB_REFERENCE_PATTERN = /\b(J-\d+)\b/gi;
const J_COMPACT_PATTERN = /\bJ\s?-?\s?(\d{1,6})\b/gi;
const JOB_FOLDER_PATH_PATTERN =
  /(?:[/\\]|^)(?:Jobs?[/\\]|J[- ]?)(\d{1,6})(?:[/\\ -]|$)/gi;
const DIMENSION_PATTERN = /\d{1,5}\s*[x×]\s*\d{1,5}/i;
const PHONE_PATTERN = /\b0\d{9,10}\b/;
const DATE_LIKE_PATTERN = /\b(19|20)\d{2}\b/;

export type JobReferenceSourceField =
  | "source_path"
  | "source_filename"
  | "job_name"
  | "document_name"
  | "stored_mapping";

export type ExtractedJobReference = {
  reference: string;
  sourceField: JobReferenceSourceField;
  confidence: number;
  matchedText: string;
};

export function normalizeJobReference(value: string) {
  const trimmed = value.trim().toUpperCase();
  const match = /^J-(\d+)$/.exec(trimmed);

  if (!match) {
    return null;
  }

  return `J-${match[1]}`;
}

export function normalizeCompactJobReference(value: string) {
  const trimmed = value.trim().toUpperCase();
  const match = /^J\s?-?\s?(\d+)$/.exec(trimmed);

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

  for (const match of text.matchAll(CANDID_JOB_REFERENCE_PATTERN)) {
    const normalized = normalizeJobReference(match[1]);

    if (normalized) {
      found.add(normalized);
    }
  }

  for (const match of text.matchAll(J_COMPACT_PATTERN)) {
    const normalized = normalizeJobReference(`J-${match[1]}`);

    if (normalized) {
      found.add(normalized);
    }
  }

  return [...found];
}

function isLikelyFalsePositiveContext(text: string, matchedText: string) {
  if (DIMENSION_PATTERN.test(text)) {
    const withoutDimensions = text.replace(DIMENSION_PATTERN, "");
    if (!extractJobReferencesFromText(withoutDimensions).length) {
      return true;
    }
  }

  if (PHONE_PATTERN.test(matchedText) || PHONE_PATTERN.test(text)) {
    return true;
  }

  if (DATE_LIKE_PATTERN.test(matchedText) && matchedText.length === 4) {
    return true;
  }

  return false;
}

function extractFromPathFolderContext(path: string): ExtractedJobReference | null {
  if (!path?.trim()) {
    return null;
  }

  const matches = [...path.matchAll(JOB_FOLDER_PATH_PATTERN)];

  if (matches.length !== 1) {
    return null;
  }

  const digits = matches[0][1];
  const reference = normalizeJobReference(`J-${digits}`);

  if (!reference) {
    return null;
  }

  const matchedText = matches[0][0];

  if (isLikelyFalsePositiveContext(path, matchedText)) {
    return null;
  }

  return {
    reference,
    sourceField: "source_path",
    confidence: 1,
    matchedText,
  };
}

function extractSingleReferenceFromText(
  text: string,
  sourceField: JobReferenceSourceField
): ExtractedJobReference | null {
  if (!text?.trim()) {
    return null;
  }

  const references = extractJobReferencesFromText(text);

  if (references.length !== 1) {
    return null;
  }

  const reference = references[0];
  const matchedText =
    text.match(new RegExp(`\\b${reference.replace("-", "-")}\\b`, "i"))?.[0] ??
    reference;

  if (isLikelyFalsePositiveContext(text, matchedText)) {
    return null;
  }

  return {
    reference,
    sourceField,
    confidence: 1,
    matchedText,
  };
}

const SEARCH_PRIORITY: Array<{
  field: JobReferenceSourceField;
  pick: (input: PrintfactoryReferenceSearchInput) => string | null;
}> = [
  { field: "source_path", pick: (input) => input.sourceFilePath },
  { field: "source_filename", pick: (input) => input.sourceFileName },
  { field: "job_name", pick: (input) => input.jobName },
  { field: "document_name", pick: (input) => input.documentName },
];

export type PrintfactoryReferenceSearchInput = {
  sourceFilePath: string | null;
  sourceFileName: string | null;
  jobName: string | null;
  documentName: string | null;
};

export function extractPrimaryJobReference(
  input: PrintfactoryReferenceSearchInput
): ExtractedJobReference | null {
  for (const { field, pick } of SEARCH_PRIORITY) {
    const text = pick(input)?.trim();

    if (!text) {
      continue;
    }

    if (field === "source_path") {
      const pathRef = extractFromPathFolderContext(text);

      if (pathRef) {
        return pathRef;
      }
    }

    const textRef = extractSingleReferenceFromText(text, field);

    if (textRef) {
      return textRef;
    }
  }

  return null;
}

export function extractConflictingJobReferences(
  input: PrintfactoryReferenceSearchInput
): string[] {
  const allRefs = new Set<string>();

  for (const { pick } of SEARCH_PRIORITY) {
    const text = pick(input)?.trim();

    if (!text) {
      continue;
    }

    for (const ref of extractJobReferencesFromText(text)) {
      allRefs.add(ref);
    }
  }

  return [...allRefs];
}

export function extractPrimaryJobReferenceFromPath(sourcePath: string): string | null {
  return extractPrimaryJobReference({
    sourceFilePath: sourcePath,
    sourceFileName: null,
    jobName: null,
    documentName: null,
  })?.reference ?? null;
}

export function pathContainsConflictingJobReferences(sourcePath: string): boolean {
  const refs = extractJobReferencesFromText(sourcePath);
  return refs.length > 1;
}

export function extractItemReferenceFromText(text: string): string | null {
  if (!text?.trim()) {
    return null;
  }

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
