import { NextResponse } from "next/server";

import { jobErrorResponse } from "@/lib/jobs/api-response";
import { requireCustomerJobContext } from "@/lib/jobs/auth";
import { ProofError } from "@/lib/proofs/errors";
import { requestJobProofChanges } from "@/lib/proofs/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string; proofId: string }> };

function proofErrorResponse(error: unknown) {
  if (error instanceof ProofError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return jobErrorResponse(error);
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: jobId, proofId } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const jobContext = await requireCustomerJobContext(supabase, user, jobId);

    if (jobContext.profile.account_status !== "approved") {
      return NextResponse.json(
        { error: "Your account must be approved before requesting changes." },
        { status: 403 }
      );
    }

    const body = (await request.json()) as { comment?: string };
    const adminClient = createAdminClient();

    await requestJobProofChanges(adminClient, {
      jobId,
      proofId,
      comment: body.comment ?? "",
      actorProfileId: jobContext.profile.id,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return proofErrorResponse(error);
  }
}
