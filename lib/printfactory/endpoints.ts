/**
 * Official PrintFactory Cloud (Aurelon) API paths.
 * Do not reintroduce legacy v1 job endpoints.
 */

export const PRINTFACTORY_API_BASE_URL_DEFAULT = "https://api.aurelon.com";

/** POST — list jobs with date filter and pagination. */
export const PRINTFACTORY_JOB_LIST_PATH = "/api/v2/job/list";

/** GET — server/API status probe (not used to retrieve jobs). */
export const PRINTFACTORY_SERVER_STATUS_PATH = "/api/v2";

/** GET — full job ticket XML including Document/Location source paths. */
export const PRINTFACTORY_JOB_DETAIL_PATH = "/api/v2/job";

/** GET — low-resolution ripped artwork preview (page is 1-based; page 1 = first page). */
export const PRINTFACTORY_JOB_THUMBNAIL_PATH = "/api/v2/job";

/** Legacy paths that must never be used in production code. */
export const FORBIDDEN_PRINTFACTORY_JOB_PATHS = [
  "/api/v1/jobs",
  "/api/v1",
] as const;

const FORBIDDEN_SOURCE_SNIPPETS = ["/api/v1/jobs", "api/v1/jobs"] as const;

/**
 * Runtime guard: throws if a forbidden PrintFactory jobs endpoint is requested.
 */
export function assertPrintfactoryJobListEndpoint(path: string) {
  const normalized = path.trim().toLowerCase();

  for (const forbidden of FORBIDDEN_PRINTFACTORY_JOB_PATHS) {
    if (normalized.includes(forbidden)) {
      throw new Error(
        `Forbidden PrintFactory endpoint "${path}". Use ${PRINTFACTORY_JOB_LIST_PATH}.`
      );
    }
  }

  if (normalized !== PRINTFACTORY_JOB_LIST_PATH.toLowerCase()) {
    throw new Error(
      `PrintFactory job list must use ${PRINTFACTORY_JOB_LIST_PATH}, received "${path}".`
    );
  }
}

/**
 * Static guard for module load — fails fast if this file ever references v1.
 */
function assertEndpointModulePolicy() {
  const moduleText = [
    PRINTFACTORY_JOB_LIST_PATH,
    PRINTFACTORY_SERVER_STATUS_PATH,
    PRINTFACTORY_API_BASE_URL_DEFAULT,
  ].join("\n");

  for (const snippet of FORBIDDEN_SOURCE_SNIPPETS) {
    if (moduleText.includes(snippet)) {
      throw new Error(
        `PrintFactory endpoints module contains forbidden path snippet: ${snippet}`
      );
    }
  }
}

assertEndpointModulePolicy();

export function buildPrintfactoryJobListUrl(baseUrl: string): string {
  assertPrintfactoryJobListEndpoint(PRINTFACTORY_JOB_LIST_PATH);
  return new URL(
    PRINTFACTORY_JOB_LIST_PATH,
    baseUrl.replace(/\/+$/, "") + "/"
  ).toString();
}

export function buildPrintfactoryServerStatusUrl(baseUrl: string): string {
  return new URL(
    PRINTFACTORY_SERVER_STATUS_PATH,
    baseUrl.replace(/\/+$/, "") + "/"
  ).toString();
}

export function buildPrintfactoryJobDetailUrl(
  baseUrl: string,
  jobGuid: string
): string {
  const trimmedGuid = jobGuid.trim();

  if (!trimmedGuid) {
    throw new Error("PrintFactory job detail requires a JobGUID.");
  }

  return new URL(
    `${PRINTFACTORY_JOB_DETAIL_PATH}/${encodeURIComponent(trimmedGuid)}`,
    baseUrl.replace(/\/+$/, "") + "/"
  ).toString();
}

/** PrintFactory thumbnail pages are 1-based (page 1 = first page; page 0 returns 404). */
export function buildPrintfactoryJobThumbnailUrl(
  baseUrl: string,
  jobGuid: string,
  page = 1
): string {
  const trimmedGuid = jobGuid.trim();

  if (!trimmedGuid) {
    throw new Error("PrintFactory thumbnail requires a JobGUID.");
  }

  const pageNumber = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;

  return new URL(
    `${PRINTFACTORY_JOB_THUMBNAIL_PATH}/${encodeURIComponent(trimmedGuid)}/thumbnail/${pageNumber}`,
    baseUrl.replace(/\/+$/, "") + "/"
  ).toString();
}

export function resolvePrintfactoryBaseUrl(): string {
  return (
    process.env.PRINTFACTORY_API_BASE_URL?.trim() ||
    PRINTFACTORY_API_BASE_URL_DEFAULT
  );
}
