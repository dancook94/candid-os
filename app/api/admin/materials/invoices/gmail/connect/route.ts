import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import {
  buildGmailAuthorizeUrl,
  createGmailOAuthState,
  GMAIL_OAUTH_STATE_COOKIE,
  gmailOAuthCookieOptions,
} from "@/lib/gmail/oauth";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const auth = await verifyApprovedAdmin(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const state = createGmailOAuthState();
    const response = NextResponse.redirect(buildGmailAuthorizeUrl(state));
    response.cookies.set(GMAIL_OAUTH_STATE_COOKIE, state, gmailOAuthCookieOptions());
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail authorization could not start.";
    return NextResponse.redirect(
      new URL(
        `/admin/materials/invoices/gmail?error=${encodeURIComponent(message)}`,
        new URL(request.url).origin
      )
    );
  }
}
