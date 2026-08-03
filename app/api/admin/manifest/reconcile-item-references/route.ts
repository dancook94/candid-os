import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmAdmin } from "@/lib/crm-auth";
import { reconcileAllMissingItemReferences } from "@/lib/printfactory/manifest-actions";
import { ProductionError } from "@/lib/production/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const auth = await verifyApprovedCrmAdmin(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let jobId: string | undefined;

  try {
    const body = (await request.json()) as { jobId?: string };
    jobId = body.jobId;
  } catch {
    jobId = undefined;
  }

  const adminClient = createAdminClient();

  try {
    const result = await reconcileAllMissingItemReferences(adminClient, jobId);

    if (jobId) {
      revalidatePath(`/admin/jobs/${jobId}`);
    }

    revalidatePath("/admin/production");
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProductionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: "Unable to reconcile item references." },
      { status: 500 }
    );
  }
}
