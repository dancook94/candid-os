import { NextResponse } from "next/server";

import { cronAuthorizationMatches } from "@/lib/gmail/cron-auth";
import { runGmailDiscoveryCron } from "@/lib/gmail/cron";
import { sanitizeGmailError } from "@/lib/gmail/errors";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }

  if (!cronAuthorizationMatches(request.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await runGmailDiscoveryCron({ admin: createAdminClient() });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, needsAttention: true, error: sanitizeGmailError(error) },
      { status: 200 }
    );
  }
}
