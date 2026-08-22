import { NextResponse } from "next/server";

import { jobErrorResponse } from "@/lib/jobs/api-response";
import { requireCustomerJobContext } from "@/lib/jobs/auth";
import { ProofError } from "@/lib/proofs/errors";
import { loadJobProofRequirement, loadProofsForJob } from "@/lib/proofs/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

function proofErrorResponse(error: unknown) {
  if (error instanceof ProofError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return jobErrorResponse(error);
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id: jobId } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    await requireCustomerJobContext(supabase, user, jobId);
    const adminClient = createAdminClient();

    const [requirement, proofsResult] = await Promise.all([
      loadJobProofRequirement(adminClient, jobId),
      loadProofsForJob(adminClient, jobId, { customerSafe: true }),
    ]);

    const customerProofs = proofsResult.proofs.filter(
      (proof) =>
        proof.status !== "draft" &&
        proof.status !== "internal_review" &&
        proof.status !== "ready_to_send" &&
        proof.status !== "cancelled"
    );

    return NextResponse.json({
      requirement,
      proofs: customerProofs,
      schemaMissing: proofsResult.schemaMissing,
    });
  } catch (error) {
    return proofErrorResponse(error);
  }
}
