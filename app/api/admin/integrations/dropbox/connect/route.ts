import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { verifySuperAdmin } from "@/lib/admin-auth";
import {
  buildDropboxAuthorizeUrl,
  createDropboxOAuthState,
  DROPBOX_OAUTH_STATE_COOKIE,
} from "@/lib/dropbox/oauth";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
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
    const cookieStore = await cookies();

    cookieStore.set(DROPBOX_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60,
      path: "/",
    });

    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to start Dropbox authorization.";

    return NextResponse.redirect(
      new URL(
        `/admin/settings/integrations/dropbox?error=${encodeURIComponent(message)}`,
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
      )
    );
  }
}
