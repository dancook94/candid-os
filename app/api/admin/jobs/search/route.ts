import { NextResponse } from "next/server";

import { searchJobsForPrintfactoryMatching } from "@/lib/jobs/create-from-printfactory";
import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";

  if (query.length < 1) {
    return NextResponse.json({ jobs: [] });
  }

  try {
    const adminClient = createAdminClient();
    const jobs = await searchJobsForPrintfactoryMatching(adminClient, query);

    return NextResponse.json({ jobs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Job search failed." },
      { status: 500 }
    );
  }
}
