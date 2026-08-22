import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import {
  inferAuthCallbackFlowFromProfile,
  resolveAuthCallbackDestination,
  resolveAuthCallbackFlow,
  resolveAuthCallbackFlowLabel,
  sanitizeCallbackNext,
} from "@/lib/auth-callback-flow";
import {
  AUTH_CALLBACK_ERRORS,
  buildAuthErrorPagePath,
  mapAuthCallbackFailure,
  parseCallbackEmailOtpType,
  type AuthCallbackErrorFlow,
} from "@/lib/auth-invite-redirect";
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

function authErrorRedirect(
  origin: string,
  errorCode: string,
  flow: AuthCallbackErrorFlow = "general"
) {
  const url = new URL(
    buildAuthErrorPagePath(errorCode as (typeof AUTH_CALLBACK_ERRORS)[keyof typeof AUTH_CALLBACK_ERRORS], flow),
    origin
  );

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
  const safeNext = sanitizeCallbackNext(next);
  const otpType = parseCallbackEmailOtpType(typeParam);
  let flow = resolveAuthCallbackFlow({ safeNext, otpType });
  const flowLabel = resolveAuthCallbackFlowLabel(flow) as AuthCallbackErrorFlow;

  logAuthCallback("Auth callback received", {
    hasCode: Boolean(code),
    hasTokenHash: Boolean(tokenHash),
    type: typeParam,
    safeNext,
    flow,
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
      ? AUTH_CALLBACK_ERRORS.confirmationExpired
      : AUTH_CALLBACK_ERRORS.callbackFailed;

    return authErrorRedirect(requestUrl.origin, errorCode, flowLabel);
  }

  if (!code && !tokenHash) {
    logAuthCallback("No auth code or token hash present; redirecting to auth error");

    return authErrorRedirect(
      requestUrl.origin,
      AUTH_CALLBACK_ERRORS.missingAuthCode,
      flowLabel
    );
  }

  if (tokenHash && typeParam && !otpType) {
    logAuthCallback("Unsupported OTP type", { type: typeParam });

    return authErrorRedirect(
      requestUrl.origin,
      AUTH_CALLBACK_ERRORS.confirmationInvalid,
      flowLabel
    );
  }

  if (tokenHash && !otpType) {
    logAuthCallback("Token hash present without a supported type");

    return authErrorRedirect(
      requestUrl.origin,
      AUTH_CALLBACK_ERRORS.missingAuthCode,
      flowLabel
    );
  }

  const cookieResponse = NextResponse.redirect(new URL("/", requestUrl.origin));
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
        flow,
      });
    } else {
      logAuthCallback("exchangeCodeForSession succeeded", { safeNext, flow });
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
        flow,
      });
    } else {
      logAuthCallback("verifyOtp succeeded", {
        type: otpType,
        safeNext,
        flow,
      });
    }
  }

  if (verificationError) {
    return authErrorRedirect(
      requestUrl.origin,
      mapAuthCallbackFailure(verificationError),
      flowLabel
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  logAuthCallback("Session established", {
    safeNext,
    flow,
    hasAuthenticatedUser: Boolean(user),
    usedCode: Boolean(code),
    usedTokenHash: Boolean(tokenHash),
    type: otpType,
  });

  if (!user) {
    return authErrorRedirect(
      requestUrl.origin,
      AUTH_CALLBACK_ERRORS.callbackFailed,
      flowLabel
    );
  }

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

    return authErrorRedirect(
      requestUrl.origin,
      AUTH_CALLBACK_ERRORS.callbackFailed,
      flowLabel
    );
  }

  if (flow === "unknown") {
    flow = inferAuthCallbackFlowFromProfile({
      profile,
      otpType,
      usedCodeExchange: Boolean(code),
      safeNext,
    });
  }

  const resolvedFlowLabel = resolveAuthCallbackFlowLabel(flow) as AuthCallbackErrorFlow;
  const destination = resolveAuthCallbackDestination({
    flow,
    profile,
    safeNext,
  });

  if (flow === "registration_confirm" && profile.user_role === "customer") {
    const adminClient = createAdminClient();
    await notifyCustomerRegistrationSafe(adminClient, user.id);
  }

  logAuthCallback("Redirecting after auth callback", {
    flow,
    destination,
    accountStatus: profile.account_status,
    userRole: profile.user_role,
  });

  return redirectWithCookies(new URL(destination, requestUrl.origin), cookieResponse);
}
