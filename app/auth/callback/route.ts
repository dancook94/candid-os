import { NextResponse } from "next/server";

import {
  resolveInviteCallbackNextPath,
  resolvePostLoginPath,
} from "@/lib/auth-redirect";
import { createRouteHandlerClient } from "@/lib/supabase/server";

const isDevelopment = process.env.NODE_ENV === "development";

function logInviteCallback(message: string, details?: Record<string, unknown>) {
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

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next");
  const authError = requestUrl.searchParams.get("error");
  const authErrorDescription = requestUrl.searchParams.get("error_description");
  const safeNext = resolveInviteCallbackNextPath(next);

  logInviteCallback("Invite callback received", {
    hasCode: Boolean(code),
    safeNext,
    hasAuthError: Boolean(authError),
    authError,
    authErrorDescription,
  });

  if (authError) {
    logInviteCallback("Supabase returned an auth error", {
      authError,
      authErrorDescription,
    });

    return NextResponse.redirect(
      new URL("/login?error=invite_callback_failed", requestUrl.origin)
    );
  }

  if (!code) {
    logInviteCallback("No auth code present; redirecting to login");

    return NextResponse.redirect(
      new URL("/login?error=invite_callback_failed", requestUrl.origin)
    );
  }

  const cookieResponse = NextResponse.redirect(new URL(safeNext, requestUrl.origin));
  const supabase = await createRouteHandlerClient(cookieResponse);

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    logInviteCallback("exchangeCodeForSession failed", {
      message: error.message,
      status: error.status,
      name: error.name,
      safeNext,
    });

    return NextResponse.redirect(
      new URL("/login?error=invite_callback_failed", requestUrl.origin)
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  logInviteCallback("exchangeCodeForSession succeeded", {
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
      logInviteCallback("Profile lookup failed after auth callback", {
        message: profileError.message,
      });
      destination = "/login";
    } else {
      destination = resolvePostLoginPath(profile, next);
    }
  }

  return redirectWithCookies(new URL(destination, requestUrl.origin), cookieResponse);
}
