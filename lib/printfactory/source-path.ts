import {
  extractFilenameFromPath,
  extractJobReferencesFromText,
} from "@/lib/printfactory/job-reference-parser";

export const PRINTFACTORY_SOURCE_PATH_STATUSES = [
  "found",
  "missing",
  "unavailable",
  "error",
] as const;

export type PrintfactorySourcePathStatus =
  (typeof PRINTFACTORY_SOURCE_PATH_STATUSES)[number];

export type PrintfactorySourceLocation = {
  documentGuid: string | null;
  documentName: string | null;
  rawLocation: string;
  normalizedLocation: string;
  extractedJobReferences: string[];
};

const WINDOWS_PUBLIC_RIP_PREFIX = /^c:[/\\]users[/\\]public/i;

/**
 * Normalize PrintFactory Document/Location values for consistent matching.
 * Preserves case in path segments; only normalizes separators and encoding.
 */
export function normalizePrintfactorySourcePath(raw: string): string {
  let value = raw.trim();

  if (!value) {
    return "";
  }

  try {
    value = decodeURIComponent(value);
  } catch {
    // keep raw value when not URI-encoded
  }

  if (/^file:/i.test(value)) {
    value = value.replace(/^file:\/+/, "");
  }

  value = value.replace(/\\/g, "/");
  value = value.replace(/\/{2,}/g, "/");

  if (/^\/\/[^/]+/.test(value)) {
    value = value.replace(/^\/\//, "");
  }

  return value.replace(/\/+$/, "");
}

export function isRipWorkingCopyPath(path: string) {
  const normalized = normalizePrintfactorySourcePath(path);
  return WINDOWS_PUBLIC_RIP_PREFIX.test(normalized);
}

export function pickPrimarySourceLocation(
  locations: PrintfactorySourceLocation[]
): PrintfactorySourceLocation | null {
  if (locations.length === 0) {
    return null;
  }

  const originals = locations.filter(
    (entry) => !isRipWorkingCopyPath(entry.rawLocation)
  );

  return originals[0] ?? locations[0] ?? null;
}

export function buildSourceLocationEntry(input: {
  documentGuid?: string | null;
  documentName?: string | null;
  rawLocation: string;
}): PrintfactorySourceLocation | null {
  const rawLocation = input.rawLocation.trim();

  if (!rawLocation) {
    return null;
  }

  const normalizedLocation = normalizePrintfactorySourcePath(rawLocation);

  if (!normalizedLocation) {
    return null;
  }

  const extractedJobReferences = extractJobReferencesFromText(
    [rawLocation, normalizedLocation].join(" ")
  );

  return {
    documentGuid: input.documentGuid?.trim() || null,
    documentName: input.documentName?.trim() || null,
    rawLocation,
    normalizedLocation,
    extractedJobReferences,
  };
}

export function dedupeSourceLocations(locations: PrintfactorySourceLocation[]) {
  const seen = new Set<string>();
  const deduped: PrintfactorySourceLocation[] = [];

  for (const entry of locations) {
    const key = [
      entry.documentGuid ?? "",
      entry.documentName ?? "",
      entry.normalizedLocation,
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}

export function collectJobReferencesFromLocations(
  locations: PrintfactorySourceLocation[]
) {
  const refs = new Set<string>();

  for (const entry of locations) {
    for (const reference of entry.extractedJobReferences) {
      refs.add(reference);
    }

    for (const reference of extractJobReferencesFromText(entry.normalizedLocation)) {
      refs.add(reference);
    }
  }

  return [...refs];
}

export function joinNormalizedLocations(locations: PrintfactorySourceLocation[]) {
  return locations.map((entry) => entry.normalizedLocation).join("\n");
}

export function resolveSourceFileName(
  primary: PrintfactorySourceLocation | null,
  fallbackDocumentName: string | null
) {
  if (!primary) {
    return fallbackDocumentName;
  }

  return (
    extractFilenameFromPath(primary.rawLocation) ??
    extractFilenameFromPath(primary.normalizedLocation) ??
    primary.documentName ??
    fallbackDocumentName
  );
}
