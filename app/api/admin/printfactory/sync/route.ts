import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmAdmin } from "@/lib/crm-auth";
import { syncPrintfactoryJobs } from "@/lib/printfactory/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function syncHttpStatus(result: Awaited<ReturnType<typeof syncPrintfactoryJobs>>) {
  if (result.ok) {
    return 200;
  }

  if (result.partial) {
    return 200;
  }

  if (result.errorCode === "not_configured") {
    return 503;
  }

  if (result.errorCode === "migration_required") {
    return 503;
  }

  return 502;
}

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
    status: syncHttpStatus(result),
  });
}
