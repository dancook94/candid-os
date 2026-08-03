import { PrintfactoryError } from "@/lib/printfactory/errors";
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
  baseUrl: string | null;
  tokenConfigured: boolean;
  jobsPath: string;
  missing: string[];
};

export function getPrintfactoryConnectionStatus(): PrintfactoryConnectionStatus {
  const baseUrl = process.env.PRINTFACTORY_API_BASE_URL?.trim() || null;
  const token =
    process.env.PRINTFACTORY_API_TOKEN?.trim() ||
    process.env.PRINTFACTORY_API_KEY?.trim() ||
    null;
  const jobsPath =
    process.env.PRINTFACTORY_JOBS_PATH?.trim() || "/api/v1/jobs";

  const missing: string[] = [];

  if (!baseUrl) {
    missing.push("PRINTFACTORY_API_BASE_URL");
  }

  if (!token) {
    missing.push("PRINTFACTORY_API_TOKEN");
  }

  return {
    configured: missing.length === 0,
    baseUrl,
    tokenConfigured: Boolean(token),
    jobsPath,
    missing,
  };
}

function normalizeApiJob(raw: Record<string, unknown>): PrintfactoryApiJob | null {
  const guid =
    (raw.guid as string | undefined) ??
    (raw.Guid as string | undefined) ??
    (raw.id as string | undefined) ??
    (raw.jobGuid as string | undefined) ??
    (raw.JobGuid as string | undefined);

  if (!guid?.trim()) {
    return null;
  }

  const sourceFilePath =
    (raw.sourceFilePath as string | undefined) ??
    (raw.source_file_path as string | undefined) ??
    (raw.SourceFilePath as string | undefined) ??
    (raw.filePath as string | undefined) ??
    (raw.path as string | undefined) ??
    null;

  const sourceFileName =
    (raw.sourceFileName as string | undefined) ??
    (raw.source_file_name as string | undefined) ??
    (raw.fileName as string | undefined) ??
    extractFilenameFromPath(sourceFilePath ?? "") ??
    null;

  const progressRaw =
    raw.progress ?? raw.Progress ?? raw.percentComplete ?? raw.percent_complete;

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
      (raw.jobName as string | undefined) ??
      (raw.JobName as string | undefined) ??
      null,
    sourceFilePath,
    sourceFileName,
    device:
      (raw.device as string | undefined) ??
      (raw.deviceName as string | undefined) ??
      (raw.Device as string | undefined) ??
      null,
    mediaType:
      (raw.mediaType as string | undefined) ??
      (raw.media_type as string | undefined) ??
      (raw.MediaType as string | undefined) ??
      null,
    producer:
      (raw.producer as string | undefined) ??
      (raw.Producer as string | undefined) ??
      null,
    status:
      (raw.status as string | undefined) ??
      (raw.Status as string | undefined) ??
      (raw.state as string | undefined) ??
      null,
    progress,
    createdAt:
      (raw.createdAt as string | undefined) ??
      (raw.created_at as string | undefined) ??
      (raw.CreatedAt as string | undefined) ??
      null,
    updatedAt:
      (raw.updatedAt as string | undefined) ??
      (raw.updated_at as string | undefined) ??
      (raw.UpdatedAt as string | undefined) ??
      null,
  };
}

function extractJobsArray(payload: unknown): Record<string, unknown>[] {
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
    record.items,
    record.data,
    record.results,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate as Record<string, unknown>[];
    }
  }

  return [];
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

  const token =
    process.env.PRINTFACTORY_API_TOKEN?.trim() ||
    process.env.PRINTFACTORY_API_KEY?.trim()!;

  const url = new URL(status.jobsPath, status.baseUrl!);

  let response: Response;

  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "X-Api-Key": token,
      },
      cache: "no-store",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PrintFactory API unreachable.";

    throw new PrintfactoryError(message, "unreachable", 502);
  }

  if (response.status === 401 || response.status === 403) {
    throw new PrintfactoryError(
      "PrintFactory API authentication failed. Check PRINTFACTORY_API_TOKEN.",
      "auth_failed",
      401
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");

    throw new PrintfactoryError(
      `PrintFactory API returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      "sync_failed",
      response.status
    );
  }

  const payload = (await response.json()) as unknown;
  const rawJobs = extractJobsArray(payload);
  const jobs = rawJobs
    .map((raw) => normalizeApiJob(raw))
    .filter((job): job is PrintfactoryApiJob => job !== null);

  return jobs;
}
