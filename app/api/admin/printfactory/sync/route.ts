import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmAdmin } from "@/lib/crm-auth";
import { syncPrintfactoryJobs } from "@/lib/printfactory/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const auth = await verifyApprovedCrmAdmin(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const adminClient = createAdminClient();
  const result = await syncPrintfactoryJobs(adminClient, auth.userId);

  revalidatePath("/admin/production");
  revalidatePath("/admin/production/printfactory-unmatched");

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.errorCode === "not_configured" ? 503 : 502,
  });
}
