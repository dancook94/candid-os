import { PrintfactoryError } from "@/lib/printfactory/errors";
import {
  PRINTFACTORY_JOB_LIST_PATH,
  PRINTFACTORY_SERVER_STATUS_PATH,
  buildPrintfactoryJobListUrl,
  buildPrintfactoryServerStatusUrl,
  resolvePrintfactoryBaseUrl,
} from "@/lib/printfactory/endpoints";
import {
  logRawPrintfactoryRecordsDev,
  normalizePrintfactoryRawJob,
} from "@/lib/printfactory/normalize";

export type PrintfactoryApiJob = {
  guid: string;
  name: string | null;
  sourceFilePath: string | null;
  sourceFileName: string | null;
  documentName: string | null;
  device: string | null;
  mediaType: string | null;
  mediaSize: string | null;
  producer: string | null;
  status: string | null;
  progress: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  rawMetadata: Record<string, unknown> | null;
};

export type PrintfactoryConnectionStatus = {
  configured: boolean;
  baseUrl: string;
  tokenConfigured: boolean;
  jobListPath: typeof PRINTFACTORY_JOB_LIST_PATH;
  serverStatusPath: typeof PRINTFACTORY_SERVER_STATUS_PATH;
  missing: string[];
};

export type PrintfactoryJobListRequestBody = {
  DateTimeFrom?: string;
  DateTimeTo?: string;
  Skip: number;
  Take: number;
};

const DEFAULT_LIST_WINDOW_DAYS = Number.parseInt(
  process.env.PRINTFACTORY_SYNC_DAYS ?? "30",
  10
) || 30;
const DEFAULT_PAGE_SIZE = 100;
const DEV_RESPONSE_LOG_LIMIT = 2048;

function truncateJsonForDevLog(payload: unknown, limit = DEV_RESPONSE_LOG_LIMIT) {
  try {
    const serialized = JSON.stringify(payload, null, 2);

    if (serialized.length <= limit) {
      return serialized;
    }

    return `${serialized.slice(0, limit)}\n… [truncated ${serialized.length - limit} chars]`;
  } catch {
    return String(payload).slice(0, limit);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function looksLikeJobRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  const guidKeys = [
    "JobGUID",
    "jobGUID",
    "guid",
    "Guid",
    "jobGuid",
    "JobGuid",
    "id",
    "Id",
    "JobId",
    "jobId",
  ];

  return guidKeys.some((key) => {
    const candidate = value[key];
    return typeof candidate === "string" || typeof candidate === "number";
  });
}

function arrayFromUnknown(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord);
}

function resolveApiToken() {
  return (
    process.env.PRINTFACTORY_API_TOKEN?.trim() ||
    process.env.PRINTFACTORY_API_KEY?.trim() ||
    null
  );
}

function buildAuthHeaders(token: string): HeadersInit {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    MisKey: token,
  };
}

function logPrintfactoryDev(
  event: string,
  details: Record<string, unknown>
) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  console.info("[printfactory]", event, details);
}

export function getPrintfactoryConnectionStatus(): PrintfactoryConnectionStatus {
  const baseUrl = resolvePrintfactoryBaseUrl();
  const token = resolveApiToken();
  const missing: string[] = [];

  if (!token) {
    missing.push("PRINTFACTORY_API_TOKEN");
  }

  return {
    configured: Boolean(token),
    baseUrl,
    tokenConfigured: Boolean(token),
    jobListPath: PRINTFACTORY_JOB_LIST_PATH,
    serverStatusPath: PRINTFACTORY_SERVER_STATUS_PATH,
    missing,
  };
}

function defaultJobListWindow(): Pick<
  PrintfactoryJobListRequestBody,
  "DateTimeFrom" | "DateTimeTo"
> {
  const dateTimeTo = new Date();
  const dateTimeFrom = new Date(dateTimeTo);
  dateTimeFrom.setDate(dateTimeFrom.getDate() - DEFAULT_LIST_WINDOW_DAYS);

  return {
    DateTimeFrom: dateTimeFrom.toISOString(),
    DateTimeTo: dateTimeTo.toISOString(),
  };
}

/** In development, omit date filters only when PRINTFACTORY_SYNC_UNFILTERED=1. */
function buildJobListRequestBody(skip: number): PrintfactoryJobListRequestBody {
  if (
    process.env.NODE_ENV === "development" &&
    process.env.PRINTFACTORY_SYNC_UNFILTERED === "1"
  ) {
    return {
      Skip: skip,
      Take: DEFAULT_PAGE_SIZE,
    };
  }

  return {
    ...defaultJobListWindow(),
    Skip: skip,
    Take: DEFAULT_PAGE_SIZE,
  };
}

export type PrintfactoryExtractDiagnostics = {
  topLevelKeys: string[];
  matchedProperty: string | null;
  nestedMatchedProperty: string | null;
  rawArrayLength: number;
  normalizedCount: number;
  droppedWithoutGuid: number;
  payloadIsArray: boolean;
};

function findJobsArrayInRecord(
  record: Record<string, unknown>,
  prefix = ""
): { property: string; items: Record<string, unknown>[] } | null {
  const directCandidates = [
    "jobs",
    "Jobs",
    "jobList",
    "JobList",
    "items",
    "Items",
    "data",
    "Data",
    "results",
    "Results",
    "result",
    "Result",
    "records",
    "Records",
    "value",
    "Value",
    "list",
    "List",
    "rows",
    "Rows",
    "entries",
    "Entries",
  ];

  for (const key of directCandidates) {
    const items = arrayFromUnknown(record[key]);

    if (items.length > 0) {
      return {
        property: prefix ? `${prefix}.${key}` : key,
        items,
      };
    }
  }

  const nestedContainers = ["data", "Data", "result", "Result", "payload", "Payload"];

  for (const containerKey of nestedContainers) {
    const nested = record[containerKey];

    if (!isRecord(nested)) {
      continue;
    }

    const nestedMatch = findJobsArrayInRecord(
      nested,
      prefix ? `${prefix}.${containerKey}` : containerKey
    );

    if (nestedMatch) {
      return nestedMatch;
    }
  }

  for (const [key, value] of Object.entries(record)) {
    const items = arrayFromUnknown(value);

    if (items.length > 0 && items.some(looksLikeJobRecord)) {
      return {
        property: prefix ? `${prefix}.${key}` : key,
        items,
      };
    }
  }

  return null;
}

export function extractJobsArrayWithDiagnostics(
  payload: unknown
): PrintfactoryExtractDiagnostics & { items: Record<string, unknown>[] } {
  const diagnostics: PrintfactoryExtractDiagnostics = {
    topLevelKeys: isRecord(payload) ? Object.keys(payload) : [],
    matchedProperty: null,
    nestedMatchedProperty: null,
    rawArrayLength: 0,
    normalizedCount: 0,
    droppedWithoutGuid: 0,
    payloadIsArray: Array.isArray(payload),
  };

  if (Array.isArray(payload)) {
    const items = arrayFromUnknown(payload);
    diagnostics.matchedProperty = "[root array]";
    diagnostics.rawArrayLength = items.length;
    return { ...diagnostics, items };
  }

  if (!isRecord(payload)) {
    return { ...diagnostics, items: [] };
  }

  const match = findJobsArrayInRecord(payload);

  if (!match) {
    return { ...diagnostics, items: [] };
  }

  if (match.property.includes(".")) {
    diagnostics.nestedMatchedProperty = match.property;
  } else {
    diagnostics.matchedProperty = match.property;
  }

  diagnostics.rawArrayLength = match.items.length;
  return { ...diagnostics, items: match.items };
}

function normalizeApiJob(raw: Record<string, unknown>): PrintfactoryApiJob | null {
  const normalized = normalizePrintfactoryRawJob(raw);

  if (!normalized) {
    return null;
  }

  return {
    guid: normalized.printfactoryJobGuid,
    name: normalized.jobName,
    sourceFilePath: normalized.sourceFilePath,
    sourceFileName: normalized.sourceFileName,
    documentName: normalized.documentName,
    device: normalized.device,
    mediaType: normalized.mediaType,
    mediaSize: normalized.mediaSize,
    producer: normalized.producer,
    status: normalized.status,
    progress: normalized.progress,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    rawMetadata: normalized.rawMetadata,
  };
}

export function extractJobsArray(payload: unknown): Record<string, unknown>[] {
  return extractJobsArrayWithDiagnostics(payload).items;
}

async function readResponsePayload(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  const rawText = await response.text();

  if (!contentType.includes("json")) {
    throw new PrintfactoryError(
      `PrintFactory API returned non-JSON response (${contentType || "unknown"}).${rawText ? ` ${rawText.slice(0, 200)}` : ""}`,
      "sync_failed",
      response.status
    );
  }

  try {
    return {
      payload: JSON.parse(rawText) as unknown,
      rawText,
    };
  } catch {
    throw new PrintfactoryError(
      `PrintFactory API returned invalid JSON.${rawText ? ` ${rawText.slice(0, 200)}` : ""}`,
      "sync_failed",
      response.status
    );
  }
}

export async function checkPrintfactoryServerStatus(): Promise<{
  ok: boolean;
  status: number;
  contentType: string | null;
}> {
  const token = resolveApiToken();

  if (!token) {
    throw new PrintfactoryError(
      "PrintFactory is not configured. Missing PRINTFACTORY_API_TOKEN.",
      "not_configured",
      503
    );
  }

  const baseUrl = resolvePrintfactoryBaseUrl();
  const url = buildPrintfactoryServerStatusUrl(baseUrl);

  logPrintfactoryDev("server-status-request", {
    url,
    method: "GET",
  });

  let response: Response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        MisKey: token,
      },
      cache: "no-store",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PrintFactory API unreachable.";

    throw new PrintfactoryError(message, "unreachable", 502);
  }

  const contentType = response.headers.get("content-type");

  logPrintfactoryDev("server-status-response", {
    url,
    method: "GET",
    status: response.status,
    contentType,
  });

  if (response.status === 401 || response.status === 403) {
    throw new PrintfactoryError(
      "PrintFactory API authentication failed. Check PRINTFACTORY_API_TOKEN.",
      "auth_failed",
      response.status
    );
  }

  return {
    ok: response.ok,
    status: response.status,
    contentType,
  };
}

async function fetchPrintfactoryJobListPage(
  token: string,
  body: PrintfactoryJobListRequestBody
): Promise<{
  jobs: PrintfactoryApiJob[];
  rawCount: number;
  firstRecordKeys: string[];
  diagnostics: PrintfactoryExtractDiagnostics;
}> {
  const baseUrl = resolvePrintfactoryBaseUrl();
  const url = buildPrintfactoryJobListUrl(baseUrl);
  const requestBody = JSON.stringify(body);

  logPrintfactoryDev("job-list-request", {
    url,
    method: "POST",
    requestBody: body,
    dateFilterApplied: Boolean(body.DateTimeFrom || body.DateTimeTo),
  });

  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: buildAuthHeaders(token),
      body: requestBody,
      cache: "no-store",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PrintFactory API unreachable.";

    throw new PrintfactoryError(message, "unreachable", 502);
  }

  const contentType = response.headers.get("content-type");
  const { payload, rawText } = await readResponsePayload(response);

  logPrintfactoryDev("job-list-response-raw", {
    url,
    method: "POST",
    requestBody: body,
    status: response.status,
    contentType,
    responseJsonPreview: truncateJsonForDevLog(payload),
    responseTextPreview:
      rawText.length > DEV_RESPONSE_LOG_LIMIT
        ? `${rawText.slice(0, DEV_RESPONSE_LOG_LIMIT)}…`
        : rawText,
  });

  if (response.status === 401 || response.status === 403) {
    throw new PrintfactoryError(
      "PrintFactory API authentication failed. Check PRINTFACTORY_API_TOKEN.",
      "auth_failed",
      response.status
    );
  }

  if (!response.ok) {
    logPrintfactoryDev("job-list-error", {
      url,
      method: "POST",
      requestBody: body,
      status: response.status,
      contentType,
      responseJsonPreview: truncateJsonForDevLog(payload),
    });

    throw new PrintfactoryError(
      `PrintFactory API returned ${response.status}${rawText ? `: ${rawText.slice(0, 200)}` : ""}`,
      "sync_failed",
      response.status
    );
  }

  const extracted = extractJobsArrayWithDiagnostics(payload);
  logRawPrintfactoryRecordsDev(extracted.items);
  const jobs = extracted.items
    .map((raw) => normalizeApiJob(raw))
    .filter((job): job is PrintfactoryApiJob => job !== null);

  const droppedWithoutGuid = extracted.rawArrayLength - jobs.length;
  const diagnostics: PrintfactoryExtractDiagnostics = {
    ...extracted,
    normalizedCount: jobs.length,
    droppedWithoutGuid,
  };

  const firstRecordKeys =
    extracted.items.length > 0 ? Object.keys(extracted.items[0] ?? {}) : [];

  let diagnosis:
    | "empty_array"
    | "wrong_property"
    | "date_filter_likely"
    | "guid_normalization_failed"
    | "ok" = "ok";

  if (extracted.rawArrayLength === 0) {
    if (isRecord(payload) && Object.keys(payload).length > 0) {
      diagnosis = "wrong_property";
    } else if (Array.isArray(payload) && payload.length === 0) {
      diagnosis = "empty_array";
    } else if (Boolean(body.DateTimeFrom || body.DateTimeTo)) {
      diagnosis = "date_filter_likely";
    } else {
      diagnosis = "empty_array";
    }
  } else if (jobs.length === 0) {
    diagnosis = "guid_normalization_failed";
  }

  logPrintfactoryDev("job-list-response", {
    url,
    method: "POST",
    requestBody: body,
    status: response.status,
    contentType,
    diagnosis,
    ...diagnostics,
    firstRecordKeys,
    recordCount: jobs.length,
  });

  return {
    jobs,
    rawCount: extracted.rawArrayLength,
    firstRecordKeys,
    diagnostics,
  };
}

export async function fetchPrintfactoryJobsFromApi(): Promise<PrintfactoryApiJob[]> {
  const status = getPrintfactoryConnectionStatus();

  if (!status.configured) {
    throw new PrintfactoryError(
      `PrintFactory is not configured. Missing: ${status.missing.join(", ")}`,
      "not_configured",
      503
    );
  }

  const token = resolveApiToken()!;

  await checkPrintfactoryServerStatus();

  const allJobs: PrintfactoryApiJob[] = [];
  let skip = 0;

  while (true) {
    const body = buildJobListRequestBody(skip);

    const page = await fetchPrintfactoryJobListPage(token, body);
    allJobs.push(...page.jobs);

    if (page.rawCount < DEFAULT_PAGE_SIZE) {
      break;
    }

    skip += DEFAULT_PAGE_SIZE;

    if (skip > 10_000) {
      break;
    }
  }

  logPrintfactoryDev("job-list-complete", {
    url: buildPrintfactoryJobListUrl(status.baseUrl),
    method: "POST",
    totalRecordCount: allJobs.length,
    syncWindowDays: DEFAULT_LIST_WINDOW_DAYS,
    unfilteredDevMode: process.env.PRINTFACTORY_SYNC_UNFILTERED === "1",
  });

  return allJobs;
}
