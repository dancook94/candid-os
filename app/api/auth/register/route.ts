import { NextResponse } from "next/server";

import { assertCustomerSelfSignupAllowed } from "@/lib/communications/auth-guards";
import { extractEmailAddress } from "@/lib/communications/config";
import { buildRegistrationConfirmRedirect } from "@/lib/auth-invite-redirect";
import {
  assertPublicRegistrationEnabled,
} from "@/lib/auth/public-registration";
import { createRouteHandlerClient } from "@/lib/supabase/server";

type RegisterBody = {
  fullName?: string;
  companyName?: string;
  email?: string;
  password?: string;
};

export async function POST(request: Request) {
  const registrationGuard = assertPublicRegistrationEnabled();

  if (!registrationGuard.ok) {
    return NextResponse.json({ error: registrationGuard.message }, { status: 403 });
  }

  let body: RegisterBody;

  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const fullName = body.fullName?.trim() ?? "";
  const companyName = body.companyName?.trim() ?? "";
  const email = extractEmailAddress(body.email ?? "");
  const password = body.password ?? "";

  if (!fullName) {
    return NextResponse.json({ error: "Full name is required." }, { status: 400 });
  }

  if (!companyName) {
    return NextResponse.json({ error: "Company name is required." }, { status: 400 });
  }

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  const signupGuard = assertCustomerSelfSignupAllowed(email);

  if (!signupGuard.ok) {
    return NextResponse.json({ error: signupGuard.message }, { status: 403 });
  }

  const requestUrl = new URL(request.url);
  const response = NextResponse.json({ ok: true });
  const supabase = await createRouteHandlerClient(response);

  const { data, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        company_name: companyName,
      },
      emailRedirectTo: buildRegistrationConfirmRedirect(requestUrl.origin),
    },
  });

  if (signUpError) {
    return NextResponse.json({ error: signUpError.message }, { status: 400 });
  }

  return NextResponse.json(
    {
      ok: true,
      hasSession: Boolean(data.session),
      userId: data.user?.id ?? null,
    },
    { headers: response.headers }
  );
}
