import { XMLParser } from "fast-xml-parser";

export const PRINTFACTORY_THUMBNAIL_MAX_PAGE = 20;
export const PRINTFACTORY_THUMBNAIL_INLINE_MAX = 6;
export const PRINTFACTORY_JOB_DETAIL_INLINE_MAX = 4;

export type RippedOutputPageCountSource = "statistics" | "job_pages";

export type RippedOutputPageCountResult = {
  rippedOutputPageCount: number;
  rippedOutputPageNumbers: number[];
  rippedOutputPageCountSource: RippedOutputPageCountSource;
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);

    if (Number.isFinite(parsed) && parsed >= 1) {
      return parsed;
    }
  }

  return null;
}

function clampOutputPageCount(count: number) {
  return Math.min(Math.max(Math.floor(count), 1), PRINTFACTORY_THUMBNAIL_MAX_PAGE);
}

/**
 * Derive ripped output sheet count from parsed PrintFactory job detail XML.
 * Primary: Statistics/Page nodes with positive @Number values.
 * Fallback: job-level <Pages>.
 */
export function parseRippedOutputPageCountFromParsedJob(
  job: Record<string, unknown> | null | undefined
): RippedOutputPageCountResult | null {
  if (!job) {
    return null;
  }

  const statisticsRoot = job.Statistics ?? job.statistics;

  if (isRecord(statisticsRoot)) {
    const pageNodes = asArray(
      statisticsRoot.Page ?? statisticsRoot.page
    ) as Record<string, unknown>[];

    const pageNumbers = [
      ...new Set(
        pageNodes
          .map((node) => parsePositiveInt(node["@_Number"] ?? node["@_number"]))
          .filter((value): value is number => value != null)
      ),
    ].sort((a, b) => a - b);

    if (pageNumbers.length > 0) {
      return {
        rippedOutputPageCount: clampOutputPageCount(pageNumbers.length),
        rippedOutputPageNumbers: pageNumbers.slice(0, PRINTFACTORY_THUMBNAIL_MAX_PAGE),
        rippedOutputPageCountSource: "statistics",
      };
    }
  }

  const jobPages = parsePositiveInt(job.Pages ?? job.pages);

  if (jobPages) {
    const pageNumbers = Array.from({ length: clampOutputPageCount(jobPages) }, (_, index) => index + 1);

    return {
      rippedOutputPageCount: clampOutputPageCount(jobPages),
      rippedOutputPageNumbers: pageNumbers,
      rippedOutputPageCountSource: "job_pages",
    };
  }

  return null;
}

export function parseRippedOutputPageCountFromXml(
  xml: string
): RippedOutputPageCountResult | null {
  let parsed: unknown;

  try {
    parsed = xmlParser.parse(xml);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const job = (parsed.Job ?? parsed.job) as Record<string, unknown> | undefined;

  return parseRippedOutputPageCountFromParsedJob(job);
}

export function readRippedOutputPageCountFromMetadata(
  rawMetadata: unknown
): number | null {
  if (!isRecord(rawMetadata)) {
    return null;
  }

  const count = parsePositiveInt(rawMetadata.rippedOutputPageCount);

  if (!count) {
    return null;
  }

  return clampOutputPageCount(count);
}

export function readRippedOutputPageNumbersFromMetadata(
  rawMetadata: unknown
): number[] | null {
  if (!isRecord(rawMetadata)) {
    return null;
  }

  const numbersRaw = rawMetadata.rippedOutputPageNumbers;

  if (!Array.isArray(numbersRaw)) {
    return null;
  }

  const numbers = numbersRaw
    .map((value) => parsePositiveInt(value))
    .filter((value): value is number => value != null);

  return numbers.length > 0 ? numbers : null;
}

export function mergeRippedOutputPageCountIntoMetadata(
  existing: Record<string, unknown> | null | undefined,
  result: RippedOutputPageCountResult | null
): Record<string, unknown> {
  const next = { ...(existing ?? {}) };

  if (!result) {
    return next;
  }

  next.rippedOutputPageCount = result.rippedOutputPageCount;
  next.rippedOutputPageCountSource = result.rippedOutputPageCountSource;

  if (result.rippedOutputPageNumbers.length > 0) {
    next.rippedOutputPageNumbers = result.rippedOutputPageNumbers;
  }

  return next;
}

export function resolveDisplayOutputPageCount(
  rawMetadata: unknown,
  fallback = 1
): number {
  return readRippedOutputPageCountFromMetadata(rawMetadata) ?? fallback;
}

export function buildOutputPageNumbers(pageCount: number): number[] {
  const clamped = clampOutputPageCount(pageCount);

  return Array.from({ length: clamped }, (_, index) => index + 1);
}
