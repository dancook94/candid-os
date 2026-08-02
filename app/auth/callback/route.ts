import { NextResponse } from "next/server";

import {
  AUTH_CALLBACK_ERRORS,
  mapAuthCallbackFailure,
} from "@/lib/auth-invite-redirect";
import {
  resolveInviteCallbackNextPath,
  resolvePostLoginPath,
  sanitizeNextPath,
} from "@/lib/auth-redirect";
import { createRouteHandlerClient } from "@/lib/supabase/server";

const isDevelopment = process.env.NODE_ENV === "development";

function logAuthCallback(message: string, details?: Record<string, unknown>) {
  if (!isDevelopment) {
    return;
  }

  console.info("[auth/callback]", message, details ?? {});
}

function redirectWithCookies(url: URL, cookieSource: NextResponse) {
  const response = NextResponse.redirect(url);

  cookieSource.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie);
  });

  response.headers.set("Cache-Control", "private, no-store");

  return response;
}

function loginErrorRedirect(
  origin: string,
  errorCode: string,
  message?: string | null
) {
  const url = new URL("/login", origin);
  url.searchParams.set("error", errorCode);

  if (message) {
    url.searchParams.set("message", message);
  }

  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next");
  const authError = requestUrl.searchParams.get("error");
  const authErrorDescription = requestUrl.searchParams.get("error_description");
  const safeNext = resolveInviteCallbackNextPath(next);

  logAuthCallback("Auth callback received", {
    hasCode: Boolean(code),
    safeNext,
    hasAuthError: Boolean(authError),
    authError,
    authErrorDescription,
  });

  if (authError) {
    logAuthCallback("Supabase returned an auth error", {
      authError,
      authErrorDescription,
    });

    const description = authErrorDescription?.toLowerCase() ?? "";
    const errorCode = description.includes("expired")
      ? AUTH_CALLBACK_ERRORS.invitationExpired
      : AUTH_CALLBACK_ERRORS.inviteAuthError;

    return loginErrorRedirect(
      requestUrl.origin,
      errorCode,
      authErrorDescription
    );
  }

  if (!code) {
    logAuthCallback("No auth code present; redirecting to login");

    return loginErrorRedirect(
      requestUrl.origin,
      AUTH_CALLBACK_ERRORS.missingInvitationCode
    );
  }

  const cookieResponse = NextResponse.redirect(
    new URL(safeNext, requestUrl.origin)
  );
  const supabase = await createRouteHandlerClient(cookieResponse);

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    logAuthCallback("exchangeCodeForSession failed", {
      message: error.message,
      status: error.status,
      name: error.name,
      safeNext,
    });

    return loginErrorRedirect(
      requestUrl.origin,
      mapAuthCallbackFailure(error),
      error.message
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  logAuthCallback("exchangeCodeForSession succeeded", {
    safeNext,
    hasAuthenticatedUser: Boolean(user),
  });

  let destination = safeNext;

  if (user && safeNext !== "/set-password") {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("account_status, user_role")
      .eq("id", user.id)
      .single();

    if (profileError) {
      logAuthCallback("Profile lookup failed after auth callback", {
        message: profileError.message,
      });

      return loginErrorRedirect(
        requestUrl.origin,
        AUTH_CALLBACK_ERRORS.invitationExchangeFailed,
        profileError.message
      );
    }

    destination = resolvePostLoginPath(profile, sanitizeNextPath(next));
  }

  return redirectWithCookies(new URL(destination, requestUrl.origin), cookieResponse);
}
