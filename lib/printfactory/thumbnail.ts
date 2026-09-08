import { PrintfactoryError } from "@/lib/printfactory/errors";
import {
  buildPrintfactoryJobThumbnailUrl,
  resolvePrintfactoryBaseUrl,
} from "@/lib/printfactory/endpoints";

/** PrintFactory Cloud uses 1-based thumbnail pages (verified: page 0 → 404, page 1 → image). */
export const PRINTFACTORY_THUMBNAIL_DEFAULT_PAGE = 1;

export type PrintfactoryThumbnailFetchResult = {
  body: ArrayBuffer;
  contentType: string;
  page: number;
};

function resolveApiToken() {
  return (
    process.env.PRINTFACTORY_API_TOKEN?.trim() ||
    process.env.PRINTFACTORY_API_KEY?.trim() ||
    null
  );
}

export function buildPrintfactoryThumbnailProxyPath(
  jobGuid: string,
  page = PRINTFACTORY_THUMBNAIL_DEFAULT_PAGE
) {
  const params = new URLSearchParams();

  if (page !== PRINTFACTORY_THUMBNAIL_DEFAULT_PAGE) {
    params.set("page", String(page));
  }

  const query = params.toString();
  const encodedGuid = encodeURIComponent(jobGuid.trim());

  return query
    ? `/api/admin/printfactory/thumbnail/${encodedGuid}?${query}`
    : `/api/admin/printfactory/thumbnail/${encodedGuid}`;
}

export async function fetchPrintfactoryJobThumbnail(
  jobGuid: string,
  page = PRINTFACTORY_THUMBNAIL_DEFAULT_PAGE
): Promise<PrintfactoryThumbnailFetchResult | null> {
  const token = resolveApiToken();

  if (!token) {
    throw new PrintfactoryError(
      "PrintFactory is not configured. Missing PRINTFACTORY_API_TOKEN.",
      "not_configured",
      503
    );
  }

  const url = buildPrintfactoryJobThumbnailUrl(
    resolvePrintfactoryBaseUrl(),
    jobGuid,
    page
  );

  let response: Response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        MisKey: token,
        Accept: "image/*,*/*",
      },
      cache: "no-store",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PrintFactory thumbnail unreachable.";

    throw new PrintfactoryError(message, "unreachable", 502);
  }

  if (response.status === 404 || response.status === 204) {
    return null;
  }

  if (response.status === 401 || response.status === 403) {
    throw new PrintfactoryError(
      "PrintFactory thumbnail authentication failed.",
      "auth_failed",
      response.status
    );
  }

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";

  if (!contentType.toLowerCase().startsWith("image/")) {
    return null;
  }

  return {
    body: await response.arrayBuffer(),
    contentType,
    page,
  };
}
