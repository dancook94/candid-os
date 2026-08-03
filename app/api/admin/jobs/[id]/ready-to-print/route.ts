import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { markJobReadyToPrintOverride } from "@/lib/manifest/service";
import { ProductionError } from "@/lib/production/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type ReadyToPrintBody = {
  reason?: string;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await context.params;
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: ReadyToPrintBody;

  try {
    body = (await request.json()) as ReadyToPrintBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.reason?.trim()) {
    return NextResponse.json({ error: "Reason is required." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  try {
    const result = await markJobReadyToPrintOverride(
      adminClient,
      jobId,
      body.reason.trim(),
      auth.userId
    );

    revalidatePath(`/admin/jobs/${jobId}`);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProductionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: "Unable to mark job ready to print." },
      { status: 500 }
    );
  }
}
