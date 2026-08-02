import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { verifySuperAdmin } from "@/lib/admin-auth";
import {
  buildPendingOAuthCookieValue,
  DROPBOX_DEFAULT_ROOT_FOLDER,
  DROPBOX_OAUTH_PENDING_COOKIE,
  DROPBOX_OAUTH_STATE_COOKIE,
  DropboxOAuthError,
  exchangeDropboxAuthorizationCode,
  getDropboxOAuthCookieOptions,
  logDropboxOperationFailure,
  usersGetCurrentAccount,
} from "@/lib/dropbox/oauth";
import { createClient } from "@/lib/supabase/server";

function buildSettingsRedirect(
  params: Record<string, string | undefined>,
  requestOrigin: string
) {
  // Keep the post-OAuth redirect on the same origin as the callback so the
  // httpOnly pending-setup cookie is not dropped (e.g. localhost vs 127.0.0.1).
  const baseUrl = requestOrigin.replace(/\/+$/, "");
  const url = new URL("/admin/settings/integrations/dropbox", baseUrl);

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const authResult = await verifySuperAdmin(supabase);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  const requestUrl = new URL(request.url);
  const error = requestUrl.searchParams.get("error_description") ??
    requestUrl.searchParams.get("error");
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(DROPBOX_OAUTH_STATE_COOKIE)?.value;

  if (error) {
    const response = buildSettingsRedirect({ error }, requestUrl.origin);
    response.cookies.delete(DROPBOX_OAUTH_STATE_COOKIE);
    return response;
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    const response = buildSettingsRedirect(
      { error: "Dropbox authorization was invalid or expired. Please try again." },
      requestUrl.origin
    );
    response.cookies.delete(DROPBOX_OAUTH_STATE_COOKIE);
    return response;
  }

  try {
    const tokenResult = await exchangeDropboxAuthorizationCode(code);
    const account = await usersGetCurrentAccount(tokenResult.access_token);
    const rootFolder =
      process.env.DROPBOX_ROOT_FOLDER?.trim() || DROPBOX_DEFAULT_ROOT_FOLDER;

    const response = buildSettingsRedirect({ setup: "pending" }, requestUrl.origin);
    response.cookies.delete(DROPBOX_OAUTH_STATE_COOKIE);
    response.cookies.set(
      DROPBOX_OAUTH_PENDING_COOKIE,
      buildPendingOAuthCookieValue({
        refreshToken: tokenResult.refresh_token!,
        accountEmail: account.email,
        accountName: account.name.display_name,
        connectedAt: new Date().toISOString(),
        rootFolder,
      }),
      getDropboxOAuthCookieOptions()
    );

    if (process.env.NODE_ENV === "development") {
      console.info("[dropbox]", {
        operation: "oauth_callback_complete",
        accountEmail: account.email,
        accountName: account.name.display_name,
        accessTokenReturned: true,
        refreshTokenReturned: true,
      });
    }

    return response;
  } catch (callbackError) {
    if (callbackError instanceof DropboxOAuthError && callbackError.details) {
      logDropboxOperationFailure(callbackError.details);
    } else if (process.env.NODE_ENV === "development") {
      console.error("[dropbox]", {
        operation: "oauth_callback",
        message:
          callbackError instanceof Error
            ? callbackError.message
            : "Dropbox authorization failed.",
      });
    }

    const message =
      callbackError instanceof Error
        ? callbackError.message
        : "Dropbox authorization failed.";

    const response = buildSettingsRedirect({ error: message }, requestUrl.origin);
    response.cookies.delete(DROPBOX_OAUTH_STATE_COOKIE);
    return response;
  }
}
