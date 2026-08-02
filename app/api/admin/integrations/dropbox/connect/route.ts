import { NextResponse } from "next/server";

import { verifySuperAdmin } from "@/lib/admin-auth";
import {
  buildDropboxAuthorizeUrl,
  createDropboxOAuthState,
  DROPBOX_OAUTH_STATE_COOKIE,
  getDropboxOAuthCookieOptions,
} from "@/lib/dropbox/oauth";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const authResult = await verifySuperAdmin(supabase);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  try {
    const state = createDropboxOAuthState();
    const authorizeUrl = buildDropboxAuthorizeUrl(state);
    const response = NextResponse.redirect(authorizeUrl);

    response.cookies.set(
      DROPBOX_OAUTH_STATE_COOKIE,
      state,
      getDropboxOAuthCookieOptions()
    );

    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to start Dropbox authorization.";

    return NextResponse.redirect(
      new URL(
        `/admin/settings/integrations/dropbox?error=${encodeURIComponent(message)}`,
        new URL(request.url).origin
      )
    );
  }
}
