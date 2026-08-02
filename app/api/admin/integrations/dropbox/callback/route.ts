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
  logDropboxOperationFailure,
  usersGetCurrentAccount,
} from "@/lib/dropbox/oauth";
import { createClient } from "@/lib/supabase/server";

function redirectToSettings(
  params: Record<string, string | undefined>,
  requestUrl: string
) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? requestUrl;
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

  cookieStore.delete(DROPBOX_OAUTH_STATE_COOKIE);

  if (error) {
    return redirectToSettings({ error }, requestUrl.origin);
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectToSettings(
      { error: "Dropbox authorization was invalid or expired. Please try again." },
      requestUrl.origin
    );
  }

  try {
    const tokenResult = await exchangeDropboxAuthorizationCode(code);
    const account = await usersGetCurrentAccount(tokenResult.access_token);
    const rootFolder =
      process.env.DROPBOX_ROOT_FOLDER?.trim() || DROPBOX_DEFAULT_ROOT_FOLDER;

    cookieStore.set(
      DROPBOX_OAUTH_PENDING_COOKIE,
      buildPendingOAuthCookieValue({
        refreshToken: tokenResult.refresh_token!,
        accountEmail: account.email,
        accountName: account.name.display_name,
        connectedAt: new Date().toISOString(),
        rootFolder,
      }),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 10 * 60,
        path: "/",
      }
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

    return redirectToSettings({ setup: "pending" }, requestUrl.origin);
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

    return redirectToSettings({ error: message }, requestUrl.origin);
  }
}
