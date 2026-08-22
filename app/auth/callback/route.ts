import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import {
  AUTH_CALLBACK_ERRORS,
  mapAuthCallbackFailure,
  parseCallbackEmailOtpType,
} from "@/lib/auth-invite-redirect";
import {
  resolveInviteCallbackNextPath,
  resolvePostLoginPath,
  sanitizeNextPath,
} from "@/lib/auth-redirect";
import { notifyCustomerRegistrationSafe } from "@/lib/notifications/triggers";
import { createRouteHandlerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const typeParam = requestUrl.searchParams.get("type");
  const next = requestUrl.searchParams.get("next");
  const authError = requestUrl.searchParams.get("error");
  const authErrorDescription = requestUrl.searchParams.get("error_description");
  const safeNext = resolveInviteCallbackNextPath(next);
  const otpType = parseCallbackEmailOtpType(typeParam);

  logAuthCallback("Auth callback received", {
    hasCode: Boolean(code),
    hasTokenHash: Boolean(tokenHash),
    type: typeParam,
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

  if (!code && !tokenHash) {
    logAuthCallback("No auth code or token hash present; redirecting to login");

    return loginErrorRedirect(
      requestUrl.origin,
      AUTH_CALLBACK_ERRORS.missingInvitationCode
    );
  }

  if (tokenHash && typeParam && !otpType) {
    logAuthCallback("Unsupported OTP type", { type: typeParam });

    return loginErrorRedirect(
      requestUrl.origin,
      AUTH_CALLBACK_ERRORS.invitationExchangeFailed,
      "This sign-in link uses an unsupported verification type."
    );
  }

  if (tokenHash && !otpType) {
    logAuthCallback("Token hash present without a supported type");

    return loginErrorRedirect(
      requestUrl.origin,
      AUTH_CALLBACK_ERRORS.missingInvitationCode,
      "This sign-in link is missing a verification type."
    );
  }

  const cookieResponse = NextResponse.redirect(
    new URL(safeNext, requestUrl.origin)
  );
  const supabase = await createRouteHandlerClient(cookieResponse);

  let verificationError: { message?: string; code?: string } | null = null;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    verificationError = error;

    if (error) {
      logAuthCallback("exchangeCodeForSession failed", {
        message: error.message,
        code: error.code,
        status: error.status,
        name: error.name,
        safeNext,
      });
    } else {
      logAuthCallback("exchangeCodeForSession succeeded", { safeNext });
    }
  } else if (tokenHash && otpType) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType as EmailOtpType,
    });
    verificationError = error;

    if (error) {
      logAuthCallback("verifyOtp failed", {
        message: error.message,
        code: error.code,
        status: error.status,
        name: error.name,
        type: otpType,
        safeNext,
      });
    } else {
      logAuthCallback("verifyOtp succeeded", {
        type: otpType,
        safeNext,
      });
    }
  }

  if (verificationError) {
    return loginErrorRedirect(
      requestUrl.origin,
      mapAuthCallbackFailure(verificationError),
      verificationError.message
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  logAuthCallback("Session established", {
    safeNext,
    hasAuthenticatedUser: Boolean(user),
    usedCode: Boolean(code),
    usedTokenHash: Boolean(tokenHash),
    type: otpType,
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
        code: profileError.code,
      });

      return loginErrorRedirect(
        requestUrl.origin,
        AUTH_CALLBACK_ERRORS.invitationExchangeFailed,
        profileError.message
      );
    }

    destination = resolvePostLoginPath(profile, sanitizeNextPath(next));

    const isRegistrationVerification = otpType === "signup" || otpType === "email";

    if (
      profile.user_role === "customer" &&
      isRegistrationVerification
    ) {
      const adminClient = createAdminClient();
      void notifyCustomerRegistrationSafe(adminClient, user.id);
    }
  }

  return redirectWithCookies(new URL(destination, requestUrl.origin), cookieResponse);
}
