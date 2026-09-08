import { XMLParser } from "fast-xml-parser";

import { PrintfactoryError } from "@/lib/printfactory/errors";
import {
  buildPrintfactoryJobDetailUrl,
  resolvePrintfactoryBaseUrl,
} from "@/lib/printfactory/endpoints";
import {
  buildSourceLocationEntry,
  dedupeSourceLocations,
  isRipWorkingCopyPath,
  type PrintfactorySourceLocation,
  type PrintfactorySourcePathStatus,
} from "@/lib/printfactory/source-path";

export type PrintfactoryJobDetailResult = {
  status: PrintfactorySourcePathStatus;
  httpStatus: number | null;
  errorMessage: string | null;
  locations: PrintfactorySourceLocation[];
  xmlLength: number | null;
};

const DETAIL_FETCH_TIMEOUT_MS = readPositiveInt(
  process.env.PRINTFACTORY_DETAIL_FETCH_TIMEOUT_MS,
  20_000
);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

function readPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractLocationFromDocumentNode(
  node: Record<string, unknown>
): string | null {
  const direct = pickString(node.Location ?? node.location);

  if (direct) {
    return direct;
  }

  return null;
}

/**
 * Walk parsed job XML and collect Document nodes that expose Location.
 * Nested imposition documents may repeat GUIDs; dedupe happens later.
 */
export function parsePrintfactoryJobDetailXml(xml: string): PrintfactorySourceLocation[] {
  let parsed: unknown;

  try {
    parsed = xmlParser.parse(xml);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid PrintFactory job XML.";

    throw new PrintfactoryError(message, "sync_failed");
  }

  if (!isRecord(parsed)) {
    return [];
  }

  const job = (parsed.Job ?? parsed.job) as Record<string, unknown> | undefined;

  if (!job) {
    return [];
  }

  const locations: PrintfactorySourceLocation[] = [];
  const documentsRoot = job.Documents ?? job.documents;

  const documentNodes = asArray(
    isRecord(documentsRoot)
      ? ((documentsRoot.Document ?? documentsRoot.document) as
          | Record<string, unknown>
          | Record<string, unknown>[]
          | undefined)
      : undefined
  );

  for (const documentNode of documentNodes) {
    if (!isRecord(documentNode)) {
      continue;
    }

    const rawLocation = extractLocationFromDocumentNode(documentNode);

    if (!rawLocation || isRipWorkingCopyPath(rawLocation)) {
      continue;
    }

    const entry = buildSourceLocationEntry({
      documentGuid: pickString(documentNode["@_GUID"] ?? documentNode["@_Guid"]),
      documentName: pickString(documentNode["@_Name"] ?? documentNode["@_name"]),
      rawLocation,
    });

    if (entry) {
      locations.push(entry);
    }
  }

  return dedupeSourceLocations(locations);
}

export async function fetchPrintfactoryJobDetail(
  jobGuid: string,
  token: string
): Promise<PrintfactoryJobDetailResult> {
  const baseUrl = resolvePrintfactoryBaseUrl();
  const url = buildPrintfactoryJobDetailUrl(baseUrl, jobGuid);

  if (process.env.NODE_ENV === "development") {
    console.info("[printfactory] detail-fetch", { jobGuid });
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/xml, text/xml, application/json",
        MisKey: token,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(DETAIL_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PrintFactory job detail unreachable.";

    return {
      status: "error",
      httpStatus: null,
      errorMessage: message,
      locations: [],
      xmlLength: null,
    };
  }

  if (response.status === 404) {
    return {
      status: "unavailable",
      httpStatus: 404,
      errorMessage: "PrintFactory job detail not found.",
      locations: [],
      xmlLength: null,
    };
  }

  if (response.status === 401 || response.status === 403) {
    throw new PrintfactoryError(
      "PrintFactory API authentication failed during job detail fetch.",
      "auth_failed",
      response.status
    );
  }

  if (!response.ok) {
    const preview = (await response.text()).slice(0, 200);

    return {
      status: "error",
      httpStatus: response.status,
      errorMessage: `PrintFactory job detail returned ${response.status}${preview ? `: ${preview}` : ""}`,
      locations: [],
      xmlLength: null,
    };
  }

  const xml = await response.text();

  try {
    const locations = parsePrintfactoryJobDetailXml(xml);

    if (process.env.NODE_ENV === "development" && locations.length > 0) {
      console.info("[printfactory] source-path-found", {
        jobGuid,
        locationCount: locations.length,
        references: locations.flatMap((entry) => entry.extractedJobReferences),
      });
    }

    return {
      status: locations.length > 0 ? "found" : "missing",
      httpStatus: response.status,
      errorMessage: locations.length > 0 ? null : "No Document/Location in job detail XML.",
      locations,
      xmlLength: xml.length,
    };
  } catch (error) {
    const message =
      error instanceof PrintfactoryError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Failed to parse PrintFactory job detail XML.";

    return {
      status: "error",
      httpStatus: response.status,
      errorMessage: message,
      locations: [],
      xmlLength: xml.length,
    };
  }
}
