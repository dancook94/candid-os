import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { reconcileProductionManifestForJob } from "@/lib/manifest/service";
import { ProductionError } from "@/lib/production/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await context.params;
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const adminClient = createAdminClient();

  try {
    const result = await reconcileProductionManifestForJob(
      adminClient,
      jobId,
      auth.userId
    );

    revalidatePath(`/admin/jobs/${jobId}`);
    revalidatePath("/admin/production");

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProductionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: "Unable to create production manifest." },
      { status: 500 }
    );
  }
}
