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

type DropboxTokenExchangeResponse = {
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

export class DropboxOAuthError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "DropboxOAuthError";
    this.status = status;
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

async function parseDropboxOAuthError(response: Response) {
  try {
    const payload = (await response.json()) as { error_description?: string; error?: string };
    return payload.error_description ?? payload.error ?? response.statusText;
  } catch {
    return response.statusText;
  }
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

  if (!response.ok) {
    const message = await parseDropboxOAuthError(response);
    throw new DropboxOAuthError(`Dropbox authorization failed: ${message}`, 502);
  }

  const payload = (await response.json()) as DropboxTokenExchangeResponse;

  if (!payload.refresh_token) {
    throw new DropboxOAuthError(
      "Dropbox did not return a refresh token. Re-authorize with offline access enabled.",
      502
    );
  }

  return payload;
}

export async function getDropboxCurrentAccount(accessToken: string) {
  const response = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const message = await parseDropboxOAuthError(response);
    throw new DropboxOAuthError(`Unable to load Dropbox account: ${message}`, 502);
  }

  return (await response.json()) as DropboxAccountResponse;
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
