import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export const DROPBOX_DEFAULT_ROOT_FOLDER = "/Candid OS Jobs";

export const DROPBOX_OAUTH_SCOPES = [
  "account_info.read",
  "files.metadata.read",
  "files.content.read",
  "files.content.write",
].join(" ");

type DropboxOAuthConfig = {
  appKey: string;
  appSecret: string;
  redirectUri: string;
};

export type DropboxTokenExchangeResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  account_id?: string;
  uid?: string;
};

type DropboxAccountResponse = {
  account_id: string;
  email: string;
  name: {
    display_name: string;
  };
};

type DropboxOAuthErrorBody = {
  error?: string;
  error_description?: string;
};

type DropboxRpcErrorBody = {
  error_summary?: string;
  error?: { ".tag"?: string } | string;
};

export type DropboxOperationFailure = {
  operation: string;
  httpStatus: number;
  errorSummary: string | null;
  errorTag: string | null;
  message: string;
  accessTokenReturned?: boolean;
  refreshTokenReturned?: boolean;
};

export class DropboxOAuthError extends Error {
  status: number;
  details: DropboxOperationFailure | null;

  constructor(message: string, status = 400, details: DropboxOperationFailure | null = null) {
    super(message);
    this.name = "DropboxOAuthError";
    this.status = status;
    this.details = details;
  }
}

function getSigningSecret() {
  const secret =
    process.env.DROPBOX_APP_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!secret) {
    throw new DropboxOAuthError(
      "Dropbox OAuth signing secret is not configured.",
      500
    );
  }

  return secret;
}

function signPayload(body: string) {
  return createHmac("sha256", getSigningSecret()).update(body).digest("base64url");
}

export function encodeSignedPayload(payload: Record<string, unknown>) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signPayload(body);
  return `${body}.${signature}`;
}

export function decodeSignedPayload<T extends Record<string, unknown>>(
  value: string
): T | null {
  const [body, signature] = value.split(".");

  if (!body || !signature) {
    return null;
  }

  const expected = signPayload(body);
  const actual = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    actual.length !== expectedBuffer.length ||
    !timingSafeEqual(actual, expectedBuffer)
  ) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function getDropboxOAuthConfig(): DropboxOAuthConfig | null {
  const appKey = process.env.DROPBOX_APP_KEY?.trim();
  const appSecret = process.env.DROPBOX_APP_SECRET?.trim();
  const redirectUri = getDropboxRedirectUri();

  if (!appKey || !appSecret || !redirectUri) {
    return null;
  }

  return { appKey, appSecret, redirectUri };
}

export function getDropboxRedirectUri() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");

  if (!appUrl) {
    return null;
  }

  return `${appUrl}/api/admin/integrations/dropbox/callback`;
}

export function createDropboxOAuthState() {
  return randomBytes(24).toString("hex");
}

export function buildDropboxAuthorizeUrl(state: string) {
  const config = getDropboxOAuthConfig();

  if (!config) {
    throw new DropboxOAuthError(
      "Dropbox OAuth is not configured. Set DROPBOX_APP_KEY, DROPBOX_APP_SECRET, and NEXT_PUBLIC_APP_URL.",
      503
    );
  }

  const params = new URLSearchParams({
    client_id: config.appKey,
    response_type: "code",
    redirect_uri: config.redirectUri,
    token_access_type: "offline",
    state,
    scope: DROPBOX_OAUTH_SCOPES,
  });

  return `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
}

function extractDropboxErrorTag(error: DropboxRpcErrorBody["error"]) {
  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object" && ".tag" in error) {
    return error[".tag"] ?? null;
  }

  return null;
}

async function readDropboxResponseBody(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function logDropboxOperationFailure(failure: DropboxOperationFailure) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  console.error("[dropbox]", {
    operation: failure.operation,
    httpStatus: failure.httpStatus,
    errorSummary: failure.errorSummary,
    errorTag: failure.errorTag,
    message: failure.message,
    accessTokenReturned: failure.accessTokenReturned ?? null,
    refreshTokenReturned: failure.refreshTokenReturned ?? null,
  });
}

function buildOAuthTokenExchangeFailure(
  response: Response,
  body: unknown
): DropboxOperationFailure {
  const oauthBody = (body ?? {}) as DropboxOAuthErrorBody;
  const message =
    oauthBody.error_description ??
    oauthBody.error ??
    `Dropbox token exchange failed with HTTP ${response.status}.`;

  return {
    operation: "oauth_token_exchange",
    httpStatus: response.status,
    errorSummary: oauthBody.error_description ?? oauthBody.error ?? null,
    errorTag: oauthBody.error ?? null,
    message,
    accessTokenReturned: false,
    refreshTokenReturned: false,
  };
}

function buildAccountLookupFailure(
  response: Response,
  body: unknown
): DropboxOperationFailure {
  const rpcBody = (body ?? {}) as DropboxRpcErrorBody;
  const errorSummary = rpcBody.error_summary ?? null;
  const errorTag = extractDropboxErrorTag(rpcBody.error);

  let message = errorSummary;

  if (errorTag === "missing_scope") {
    message = "missing account_info.read permission";
  } else if (response.status === 401) {
    message = "access token was rejected";
  } else if (!message) {
    message = `HTTP ${response.status}`;
  }

  return {
    operation: "users_get_current_account",
    httpStatus: response.status,
    errorSummary,
    errorTag,
    message,
  };
}

function toAdminSafeDropboxError(prefix: string, failure: DropboxOperationFailure) {
  return `${prefix}: ${failure.message}`;
}

export async function exchangeDropboxAuthorizationCode(code: string) {
  const config = getDropboxOAuthConfig();

  if (!config) {
    throw new DropboxOAuthError("Dropbox OAuth is not configured.", 503);
  }

  const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: config.appKey,
      client_secret: config.appSecret,
      redirect_uri: config.redirectUri,
    }),
  });

  const body = await readDropboxResponseBody(response);

  if (!response.ok) {
    const failure = buildOAuthTokenExchangeFailure(response, body);
    logDropboxOperationFailure(failure);
    throw new DropboxOAuthError(
      toAdminSafeDropboxError("Dropbox token exchange failed", failure),
      502,
      failure
    );
  }

  const payload = body as DropboxTokenExchangeResponse;
  const accessTokenReturned = Boolean(payload?.access_token);
  const refreshTokenReturned = Boolean(payload?.refresh_token);

  if (!accessTokenReturned) {
    const failure: DropboxOperationFailure = {
      operation: "oauth_token_exchange",
      httpStatus: response.status,
      errorSummary: "missing access_token",
      errorTag: "missing_access_token",
      message: "Dropbox token exchange did not return an access token.",
      accessTokenReturned,
      refreshTokenReturned,
    };
    logDropboxOperationFailure(failure);
    throw new DropboxOAuthError(failure.message, 502, failure);
  }

  if (!refreshTokenReturned) {
    const failure: DropboxOperationFailure = {
      operation: "oauth_token_exchange",
      httpStatus: response.status,
      errorSummary: "missing refresh_token",
      errorTag: "missing_refresh_token",
      message:
        "Dropbox did not return a refresh token. Confirm token_access_type=offline is enabled and re-authorize.",
      accessTokenReturned,
      refreshTokenReturned,
    };
    logDropboxOperationFailure(failure);
    throw new DropboxOAuthError(failure.message, 502, failure);
  }

  if (process.env.NODE_ENV === "development") {
    console.info("[dropbox]", {
      operation: "oauth_token_exchange",
      httpStatus: response.status,
      accessTokenReturned,
      refreshTokenReturned,
      redirectUri: config.redirectUri,
    });
  }

  return payload;
}

export async function usersGetCurrentAccount(accessToken: string) {
  const response = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: "null",
  });

  const body = await readDropboxResponseBody(response);

  if (!response.ok) {
    const failure = buildAccountLookupFailure(response, body);
    logDropboxOperationFailure(failure);
    throw new DropboxOAuthError(
      toAdminSafeDropboxError("Dropbox account lookup failed", failure),
      502,
      failure
    );
  }

  return body as DropboxAccountResponse;
}

export const getDropboxCurrentAccount = usersGetCurrentAccount;

export function maskDropboxRefreshToken(token: string) {
  if (token.length <= 12) {
    return "••••••••";
  }

  return `${token.slice(0, 8)}${"•".repeat(Math.min(24, token.length - 12))}${token.slice(-4)}`;
}

export type DropboxPendingOAuthResult = {
  refreshToken: string;
  accountEmail: string;
  accountName: string;
  connectedAt: string;
  rootFolder: string;
};

export const DROPBOX_OAUTH_STATE_COOKIE = "dropbox_oauth_state";
export const DROPBOX_OAUTH_PENDING_COOKIE = "dropbox_oauth_pending";

export function getDropboxOAuthCookieOptions(maxAge = 10 * 60) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge,
    path: "/",
  };
}

export function buildPendingOAuthCookieValue(result: DropboxPendingOAuthResult) {
  return encodeSignedPayload({
    ...result,
    exp: Date.now() + 10 * 60 * 1000,
  });
}

export function parsePendingOAuthCookieValue(
  value: string | undefined
): DropboxPendingOAuthResult | null {
  if (!value) {
    return null;
  }

  const payload = decodeSignedPayload<
    DropboxPendingOAuthResult & { exp?: number }
  >(value);

  if (!payload?.refreshToken || !payload.accountEmail) {
    return null;
  }

  if (payload.exp && payload.exp < Date.now()) {
    return null;
  }

  return {
    refreshToken: payload.refreshToken,
    accountEmail: payload.accountEmail,
    accountName: payload.accountName,
    connectedAt: payload.connectedAt,
    rootFolder: payload.rootFolder,
  };
}
