import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { confirmManifestProofRequirements } from "@/lib/manifest/proof-requirement-service";
import { ProofError } from "@/lib/proofs/errors";
import { syncJobProofWorkflowStatus } from "@/lib/proofs/gates";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const supabase = await createClient();
  const auth = await verifyApprovedCrmStaff(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id: jobId } = await context.params;
  const adminClient = createAdminClient();

  try {
    const result = await confirmManifestProofRequirements(
      adminClient,
      jobId,
      auth.userId
    );

    await syncJobProofWorkflowStatus(adminClient, jobId);

    revalidatePath(`/admin/jobs/${jobId}`);
    revalidatePath("/admin/production");

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProofError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: "Unable to confirm proof requirements." },
      { status: 500 }
    );
  }
}
