const PRODUCTION_ORIGINS = new Set([
  "https://candidcreative.uk",
  "https://www.candidcreative.uk",
]);

export const WEBSITE_ARTWORK_CORS_DEV_ORIGINS_ENV = "CANDID_OS_WEBSITE_CORS_DEV_ORIGINS";

const ALLOWED_METHODS = "POST, OPTIONS";
const ALLOWED_HEADERS = "Authorization, Content-Type, x-upload-offset, x-chunk-sha256";
const MAX_AGE_SECONDS = "600";

function exactOrigin(value: string) {
  const origin = value.trim();

  if (!origin || origin === "*" || origin.includes("*")) {
    return null;
  }

  try {
    const url = new URL(origin);

    if (url.origin !== origin || url.username || url.password) {
      return null;
    }

    return origin;
  } catch {
    return null;
  }
}

function developmentOrigins() {
  if (process.env.NODE_ENV !== "development") {
    return [];
  }

  return (process.env[WEBSITE_ARTWORK_CORS_DEV_ORIGINS_ENV] ?? "")
    .split(",")
    .map((value) => exactOrigin(value))
    .filter((value): value is string => value !== null);
}

export function allowedWebsiteArtworkOrigin(originHeader: string | null) {
  const origin = originHeader ? exactOrigin(originHeader) : null;

  if (!origin) {
    return null;
  }

  if (PRODUCTION_ORIGINS.has(origin) || developmentOrigins().includes(origin)) {
    return origin;
  }

  return null;
}

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": MAX_AGE_SECONDS,
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
}

export function websiteArtworkPreflight(request: Request) {
  const origin = allowedWebsiteArtworkOrigin(request.headers.get("origin"));

  if (!origin) {
    return new Response(null, {
      status: 403,
      headers: {
        Vary: "Origin",
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

export function withWebsiteArtworkCors(request: Request, response: Response) {
  const origin = allowedWebsiteArtworkOrigin(request.headers.get("origin"));

  if (!origin) {
    return response;
  }

  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(corsHeaders(origin))) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
