import { NextResponse } from "next/server";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import {
  GLOBAL_SEARCH_MAX_LENGTH,
  GLOBAL_SEARCH_MIN_LENGTH,
} from "@/lib/crm/global-search-sanitize";
import { runGlobalSearch } from "@/lib/crm/global-search-query";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const rawQuery = searchParams.get("q")?.trim() ?? "";

  if (rawQuery.length < GLOBAL_SEARCH_MIN_LENGTH) {
    return NextResponse.json(
      { error: `Enter at least ${GLOBAL_SEARCH_MIN_LENGTH} characters.` },
      { status: 400 }
    );
  }

  if (rawQuery.length > GLOBAL_SEARCH_MAX_LENGTH) {
    return NextResponse.json({ error: "Search query is too long." }, { status: 400 });
  }

  try {
    const results = await runGlobalSearch(supabase, rawQuery);

    return NextResponse.json({ results });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Global search failed.";

    if (process.env.NODE_ENV === "development") {
      console.error("[global-search]", message);
    }

    return NextResponse.json(
      { error: "Search unavailable. Please try again." },
      { status: 500 }
    );
  }
}
