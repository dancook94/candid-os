import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { saveGmailConnection } from "@/lib/gmail/connection";
import { GMAIL_IMPORT_MAILBOX } from "@/lib/gmail/config";
import { sanitizeGmailError } from "@/lib/gmail/errors";
import {
  exchangeGmailAuthorizationCode,
  fetchGmailProfile,
  gmailOAuthCallbackStateAccepted,
  gmailScopeIsReadOnly,
  GMAIL_OAUTH_STATE_COOKIE,
  revokeGmailToken,
} from "@/lib/gmail/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function redirectToImport(origin: string, params: Record<string, string | undefined>) {
  const url = new URL("/admin/materials/invoices/gmail", origin);

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  const response = NextResponse.redirect(url);
  response.cookies.delete(GMAIL_OAUTH_STATE_COOKIE);
  return response;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const auth = await verifyApprovedAdmin(supabase);
  const requestUrl = new URL(request.url);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const oauthError =
    requestUrl.searchParams.get("error_description") ?? requestUrl.searchParams.get("error");
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(GMAIL_OAUTH_STATE_COOKIE)?.value;

  if (oauthError) {
    return redirectToImport(requestUrl.origin, { error: sanitizeGmailError(new Error(oauthError)) });
  }

  if (!code || !gmailOAuthCallbackStateAccepted(state, expectedState)) {
    return redirectToImport(requestUrl.origin, {
      error: "Gmail authorization was invalid or expired. Try again.",
    });
  }

  let unusedRefreshToken: string | null = null;

  try {
    const token = await exchangeGmailAuthorizationCode(code);

    if (!token.refreshToken) {
      await revokeGmailToken(token.accessToken);
      return redirectToImport(requestUrl.origin, {
        error: "Gmail did not return a refresh token. Try connecting again.",
      });
    }

    unusedRefreshToken = token.refreshToken;

    const profile = await fetchGmailProfile(token.accessToken);

    if (profile.email !== GMAIL_IMPORT_MAILBOX) {
      await revokeGmailToken(token.refreshToken);
      return redirectToImport(requestUrl.origin, {
        error: `Connect ${GMAIL_IMPORT_MAILBOX}. Google returned ${profile.email}.`,
      });
    }

    if (!gmailScopeIsReadOnly(token.scope)) {
      await revokeGmailToken(token.refreshToken);
      return redirectToImport(requestUrl.origin, {
        error: "Gmail did not grant read-only access.",
      });
    }

    await saveGmailConnection({
      admin: createAdminClient(),
      userId: auth.userId,
      refreshToken: token.refreshToken,
      googleEmail: profile.email,
      historyId: profile.historyId,
      scope: token.scope,
    });
    unusedRefreshToken = null;

    return redirectToImport(requestUrl.origin, { connected: "1" });
  } catch (error) {
    if (unusedRefreshToken) {
      try {
        await revokeGmailToken(unusedRefreshToken);
      } catch {
        // The token was not stored. Revocation is best-effort.
      }
    }

    return redirectToImport(requestUrl.origin, { error: sanitizeGmailError(error) });
  }
}
