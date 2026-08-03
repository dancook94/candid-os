import { PrintfactoryError } from "@/lib/printfactory/errors";
import {
  PRINTFACTORY_JOB_LIST_PATH,
  PRINTFACTORY_SERVER_STATUS_PATH,
  buildPrintfactoryJobListUrl,
  buildPrintfactoryServerStatusUrl,
  resolvePrintfactoryBaseUrl,
} from "@/lib/printfactory/endpoints";
import { extractFilenameFromPath } from "@/lib/printfactory/job-reference-parser";

export type PrintfactoryApiJob = {
  guid: string;
  name: string | null;
  sourceFilePath: string | null;
  sourceFileName: string | null;
  device: string | null;
  mediaType: string | null;
  producer: string | null;
  status: string | null;
  progress: number | null;
  createdAt: string | null;
  updatedAt: string | null;
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
  DateTimeFrom: string;
  DateTimeTo: string;
  Skip: number;
  Take: number;
};

const DEFAULT_LIST_WINDOW_DAYS = 30;
const DEFAULT_PAGE_SIZE = 100;

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

function normalizeApiJob(raw: Record<string, unknown>): PrintfactoryApiJob | null {
  const guid =
    (raw.guid as string | undefined) ??
    (raw.Guid as string | undefined) ??
    (raw.JobGuid as string | undefined) ??
    (raw.jobGuid as string | undefined) ??
    (raw.id as string | undefined) ??
    (raw.Id as string | undefined);

  if (!guid?.trim()) {
    return null;
  }

  const sourceFilePath =
    (raw.sourceFilePath as string | undefined) ??
    (raw.SourceFilePath as string | undefined) ??
    (raw.source_file_path as string | undefined) ??
    (raw.FilePath as string | undefined) ??
    (raw.filePath as string | undefined) ??
    (raw.path as string | undefined) ??
    (raw.Path as string | undefined) ??
    null;

  const sourceFileName =
    (raw.sourceFileName as string | undefined) ??
    (raw.SourceFileName as string | undefined) ??
    (raw.source_file_name as string | undefined) ??
    (raw.FileName as string | undefined) ??
    (raw.fileName as string | undefined) ??
    extractFilenameFromPath(sourceFilePath ?? "") ??
    null;

  const progressRaw =
    raw.progress ??
    raw.Progress ??
    raw.percentComplete ??
    raw.PercentComplete ??
    raw.percent_complete;

  let progress: number | null = null;

  if (typeof progressRaw === "number" && Number.isFinite(progressRaw)) {
    progress = progressRaw;
  } else if (typeof progressRaw === "string") {
    const parsed = Number.parseFloat(progressRaw);
    progress = Number.isFinite(parsed) ? parsed : null;
  }

  return {
    guid: guid.trim(),
    name:
      (raw.name as string | undefined) ??
      (raw.Name as string | undefined) ??
      (raw.jobName as string | undefined) ??
      (raw.JobName as string | undefined) ??
      null,
    sourceFilePath,
    sourceFileName,
    device:
      (raw.device as string | undefined) ??
      (raw.Device as string | undefined) ??
      (raw.deviceName as string | undefined) ??
      (raw.DeviceName as string | undefined) ??
      null,
    mediaType:
      (raw.mediaType as string | undefined) ??
      (raw.MediaType as string | undefined) ??
      (raw.media_type as string | undefined) ??
      null,
    producer:
      (raw.producer as string | undefined) ??
      (raw.Producer as string | undefined) ??
      null,
    status:
      (raw.status as string | undefined) ??
      (raw.Status as string | undefined) ??
      (raw.state as string | undefined) ??
      (raw.State as string | undefined) ??
      (raw.jobState as string | undefined) ??
      (raw.JobState as string | undefined) ??
      null,
    progress,
    createdAt:
      (raw.createdAt as string | undefined) ??
      (raw.CreatedAt as string | undefined) ??
      (raw.created_at as string | undefined) ??
      (raw.DateTimeCreated as string | undefined) ??
      null,
    updatedAt:
      (raw.updatedAt as string | undefined) ??
      (raw.UpdatedAt as string | undefined) ??
      (raw.updated_at as string | undefined) ??
      (raw.DateTimeUpdated as string | undefined) ??
      null,
  };
}

export function extractJobsArray(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload as Record<string, unknown>[];
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const candidates = [
    record.jobs,
    record.Jobs,
    record.jobList,
    record.JobList,
    record.items,
    record.Items,
    record.data,
    record.Data,
    record.results,
    record.Results,
    record.records,
    record.Records,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate as Record<string, unknown>[];
    }
  }

  return [];
}

async function parseJsonResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("json")) {
    const text = await response.text().catch(() => "");
    throw new PrintfactoryError(
      `PrintFactory API returned non-JSON response (${contentType || "unknown"}).${text ? ` ${text.slice(0, 200)}` : ""}`,
      "sync_failed",
      response.status
    );
  }

  return (await response.json()) as unknown;
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
): Promise<{ jobs: PrintfactoryApiJob[]; rawCount: number; firstRecordKeys: string[] }> {
  const baseUrl = resolvePrintfactoryBaseUrl();
  const url = buildPrintfactoryJobListUrl(baseUrl);

  logPrintfactoryDev("job-list-request", {
    url,
    method: "POST",
    body,
  });

  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: buildAuthHeaders(token),
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PrintFactory API unreachable.";

    throw new PrintfactoryError(message, "unreachable", 502);
  }

  const contentType = response.headers.get("content-type");

  if (response.status === 401 || response.status === 403) {
    throw new PrintfactoryError(
      "PrintFactory API authentication failed. Check PRINTFACTORY_API_TOKEN.",
      "auth_failed",
      response.status
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");

    logPrintfactoryDev("job-list-error", {
      url,
      method: "POST",
      status: response.status,
      contentType,
    });

    throw new PrintfactoryError(
      `PrintFactory API returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      "sync_failed",
      response.status
    );
  }

  const payload = await parseJsonResponse(response);
  const rawJobs = extractJobsArray(payload);
  const jobs = rawJobs
    .map((raw) => normalizeApiJob(raw))
    .filter((job): job is PrintfactoryApiJob => job !== null);

  const firstRecordKeys =
    rawJobs.length > 0 ? Object.keys(rawJobs[0] ?? {}) : [];

  logPrintfactoryDev("job-list-response", {
    url,
    method: "POST",
    status: response.status,
    contentType,
    recordCount: jobs.length,
    firstRecordKeys,
  });

  return {
    jobs,
    rawCount: rawJobs.length,
    firstRecordKeys,
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

  const window = defaultJobListWindow();
  const allJobs: PrintfactoryApiJob[] = [];
  let skip = 0;

  while (true) {
    const body: PrintfactoryJobListRequestBody = {
      ...window,
      Skip: skip,
      Take: DEFAULT_PAGE_SIZE,
    };

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
  });

  return allJobs;
}
