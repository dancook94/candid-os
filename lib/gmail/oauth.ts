import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { GMAIL_READONLY_SCOPE } from "@/lib/gmail/config";
import { sanitizeGmailError, type GmailRequestError } from "@/lib/gmail/errors";

export const GMAIL_OAUTH_STATE_COOKIE = "gmail_oauth_state";

type GmailTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GmailProfile = {
  emailAddress?: string;
  historyId?: string;
};

function signingSecret() {
  const secret = process.env.GMAIL_CLIENT_SECRET?.trim();

  if (!secret) {
    throw new Error("GMAIL_CLIENT_SECRET is not configured.");
  }

  return secret;
}

function sign(body: string) {
  return createHmac("sha256", signingSecret()).update(body).digest("base64url");
}

export function gmailRedirectUri() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");

  if (!appUrl) {
    return null;
  }

  return `${appUrl}/api/admin/materials/invoices/gmail/callback`;
}

export function createGmailOAuthState(expiresAt = Date.now() + 10 * 60 * 1000) {
  const body = Buffer.from(
    JSON.stringify({ nonce: randomBytes(24).toString("hex"), exp: expiresAt })
  ).toString("base64url");

  return `${body}.${sign(body)}`;
}

export function gmailOAuthCallbackStateAccepted(
  state: string | null,
  expectedState: string | undefined
) {
  return Boolean(
    state &&
      verifyGmailOAuthState(state) &&
      expectedState &&
      gmailOAuthStatesMatch(state, expectedState)
  );
}

export function gmailOAuthStatesMatch(left: string, right: string) {
  const actual = Buffer.from(left);
  const expected = Buffer.from(right);

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function gmailScopeIsReadOnly(scope: string) {
  const scopes = scope.split(/\s+/).filter(Boolean);
  return scopes.length > 0 && scopes.every((item) => item === GMAIL_READONLY_SCOPE);
}

export function verifyGmailOAuthState(value: string | undefined) {
  if (!value) {
    return false;
  }

  const [body, signature] = value.split(".");

  if (!body || !signature) {
    return false;
  }

  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

export function gmailOAuthCookieOptions(maxAge = 10 * 60) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge,
    path: "/",
  };
}

export function buildGmailAuthorizeUrl(state: string) {
  const clientId = process.env.GMAIL_CLIENT_ID?.trim();
  const redirectUri = gmailRedirectUri();

  if (!clientId || !redirectUri) {
    throw new Error("Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and NEXT_PUBLIC_APP_URL.");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_READONLY_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function postToken(body: URLSearchParams) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json()) as GmailTokenResponse;

  if (!response.ok || !payload.access_token) {
    const error = new Error(
      sanitizeGmailError(
        new Error(payload.error_description || payload.error || "Gmail authorization failed.")
      )
    ) as GmailRequestError;
    error.status = response.status;
    error.code = payload.error;
    throw error;
  }

  return payload;
}

export async function exchangeGmailAuthorizationCode(code: string) {
  const clientId = process.env.GMAIL_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim();
  const redirectUri = gmailRedirectUri();

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Gmail OAuth is not configured.");
  }

  const payload = await postToken(
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    })
  );

  return {
    accessToken: payload.access_token as string,
    refreshToken: payload.refresh_token ?? null,
    scope: payload.scope ?? GMAIL_READONLY_SCOPE,
  };
}

export async function refreshGmailAccessToken(refreshToken: string) {
  const clientId = process.env.GMAIL_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error("Gmail OAuth is not configured.");
  }

  const payload = await postToken(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    })
  );

  return {
    accessToken: payload.access_token as string,
    refreshToken: payload.refresh_token ?? null,
  };
}

export async function revokeGmailToken(token: string) {
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });

  if (!response.ok && response.status !== 400) {
    throw new Error("Gmail token revocation failed.");
  }
}

export async function fetchGmailProfile(accessToken: string) {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error("The Gmail mailbox could not be confirmed.");
  }

  const profile = (await response.json()) as GmailProfile;

  if (!profile.emailAddress) {
    throw new Error("The Gmail mailbox did not return an address.");
  }

  return {
    email: profile.emailAddress.toLowerCase(),
    historyId: profile.historyId ?? null,
  };
}
