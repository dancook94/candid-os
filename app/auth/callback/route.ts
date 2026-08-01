import { NextResponse } from "next/server";

import { resolvePostLoginPath } from "@/lib/auth-redirect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (code) {
    const supabase = await createClient();

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(
        new URL("/login?error=verification_failed", requestUrl.origin)
      );
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("account_status, user_role")
        .eq("id", user.id)
        .single();

      return NextResponse.redirect(
        new URL(resolvePostLoginPath(profile, null), requestUrl.origin)
      );
    }
  }

  return NextResponse.redirect(new URL("/dashboard", requestUrl.origin));
}
