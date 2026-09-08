/**
 * Strict Candid job reference parser for Synology / PrintFactory paths.
 *
 * Valid formats: J-1048, J1048 (word boundary), Jobs/J-1048 folders, and legacy
 * server folders such as 1897pwruno / 1897-pwr / 1897.
 * Matches buildJobReference() in lib/jobs/create-from-quote.ts
 */

const CANDID_JOB_REFERENCE_PATTERN = /\b(J-\d+)\b/gi;
const J_COMPACT_PATTERN = /\bJ\s?-?\s?(\d{1,6})\b/gi;
const JOB_FOLDER_PATH_PATTERN =
  /(?:[/\\]|^)(?:Jobs?[/\\]|J[- ]?)(\d{1,6})(?:[/\\ -]|$)/gi;
const NUMERIC_JOB_FOLDER_SEGMENT_PATTERNS = [
  /^(\d{1,6})$/,
  /^(\d{1,6})[-_\s](.+)$/,
  /^(\d{1,6})([a-zA-Z].*)$/,
] as const;
const DATE_SEGMENT_PATTERN = /^\d{2}\.\d{2}\.\d{2}$/;
const ISO_DATE_SEGMENT_PATTERN = /\d{4}-\d{2}-\d{2}/;
const WETRANSFER_SEGMENT_PATTERN = /^wetransfer/i;
const DIMENSION_PATTERN = /\d{1,5}\s*[x×]\s*\d{1,5}/i;
const ITEM_FOLDER_SEGMENT_PATTERN = /^item\s+\d+/i;
const YEAR_ORDERS_SEGMENT_PATTERN = /^(19|20)\d{2}\s+ORDERS$/i;
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

function splitPathSegments(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean);
}

function isRecentCalendarYearSegment(segment: string, digits: string) {
  const year = Number.parseInt(digits, 10);

  if (!Number.isFinite(year) || year < 2000 || year > 2099) {
    return false;
  }

  const trimmed = segment.trim();

  if (trimmed === String(year)) {
    return true;
  }

  if (YEAR_ORDERS_SEGMENT_PATTERN.test(trimmed)) {
    return true;
  }

  return new RegExp(`^${year}\\s+`, "i").test(trimmed);
}

function isRejectedJobFolderSegment(segment: string) {
  const trimmed = segment.trim();

  if (!trimmed) {
    return true;
  }

  if (DATE_SEGMENT_PATTERN.test(trimmed)) {
    return true;
  }

  if (ISO_DATE_SEGMENT_PATTERN.test(trimmed)) {
    return true;
  }

  if (WETRANSFER_SEGMENT_PATTERN.test(trimmed)) {
    return true;
  }

  if (DIMENSION_PATTERN.test(trimmed)) {
    return true;
  }

  if (ITEM_FOLDER_SEGMENT_PATTERN.test(trimmed)) {
    return true;
  }

  if (YEAR_ORDERS_SEGMENT_PATTERN.test(trimmed)) {
    return true;
  }

  return false;
}

function extractJobNumberFromFolderSegment(segment: string): string | null {
  if (isRejectedJobFolderSegment(segment)) {
    return null;
  }

  const trimmed = segment.trim();

  for (const pattern of NUMERIC_JOB_FOLDER_SEGMENT_PATTERNS) {
    const match = pattern.exec(trimmed);

    if (!match) {
      continue;
    }

    const digits = match[1];

    if (isRecentCalendarYearSegment(trimmed, digits)) {
      continue;
    }

    return normalizeJobReference(`J-${digits}`);
  }

  return null;
}

/** Legacy server folders such as /1897pwruno/ — segment-aware, not whole-path digit scan. */
export function extractNumericJobFolderReferencesFromPath(path: string): string[] {
  if (!path?.trim()) {
    return [];
  }

  const found = new Set<string>();

  for (const segment of splitPathSegments(path)) {
    const reference = extractJobNumberFromFolderSegment(segment);

    if (reference) {
      found.add(reference);
    }
  }

  return [...found];
}

function findNumericJobFolderMatch(path: string): ExtractedJobReference | null {
  const segments = splitPathSegments(path);
  const matches: ExtractedJobReference[] = [];

  for (const segment of segments) {
    const reference = extractJobNumberFromFolderSegment(segment);

    if (!reference) {
      continue;
    }

    matches.push({
      reference,
      sourceField: "source_path",
      confidence: 1,
      matchedText: segment,
    });
  }

  const uniqueReferences = new Set(matches.map((entry) => entry.reference));

  if (uniqueReferences.size !== 1 || matches.length === 0) {
    return null;
  }

  return matches[0] ?? null;
}

function extractFromPathFolderContext(path: string): ExtractedJobReference | null {
  if (!path?.trim()) {
    return null;
  }

  const explicitRefs = extractJobReferencesFromText(path);

  if (explicitRefs.length === 1) {
    const reference = explicitRefs[0];
    const matchedText =
      path.match(new RegExp(`\\b${reference.replace("-", "\\-")}\\b`, "i"))?.[0] ??
      reference;

    if (!isLikelyFalsePositiveContext(path, matchedText)) {
      return {
        reference,
        sourceField: "source_path",
        confidence: 1,
        matchedText,
      };
    }
  }

  if (explicitRefs.length > 1) {
    return null;
  }

  const legacyMatches = [...path.matchAll(JOB_FOLDER_PATH_PATTERN)];

  if (legacyMatches.length === 1) {
    const digits = legacyMatches[0][1];
    const reference = normalizeJobReference(`J-${digits}`);

    if (reference) {
      const matchedText = legacyMatches[0][0];

      if (!isLikelyFalsePositiveContext(path, matchedText)) {
        return {
          reference,
          sourceField: "source_path",
          confidence: 1,
          matchedText,
        };
      }
    }
  }

  if (legacyMatches.length > 1) {
    return null;
  }

  const numericFolderMatch = findNumericJobFolderMatch(path);

  if (numericFolderMatch && !isLikelyFalsePositiveContext(path, numericFolderMatch.matchedText)) {
    return numericFolderMatch;
  }

  return null;
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

  for (const { field, pick } of SEARCH_PRIORITY) {
    const text = pick(input)?.trim();

    if (!text) {
      continue;
    }

    for (const ref of extractJobReferencesFromText(text)) {
      allRefs.add(ref);
    }

    if (field === "source_path") {
      for (const ref of extractNumericJobFolderReferencesFromPath(text)) {
        allRefs.add(ref);
      }
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
