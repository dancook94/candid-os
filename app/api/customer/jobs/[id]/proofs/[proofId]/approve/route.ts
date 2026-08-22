import { NextResponse } from "next/server";

import { jobErrorResponse } from "@/lib/jobs/api-response";
import { requireCustomerJobContext } from "@/lib/jobs/auth";
import { ProofError } from "@/lib/proofs/errors";
import { approveJobProof, markProofViewed } from "@/lib/proofs/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string; proofId: string }> };

function proofErrorResponse(error: unknown) {
  if (error instanceof ProofError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return jobErrorResponse(error);
}

function extractClientMeta(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ipAddress = forwarded?.split(",")[0]?.trim() ?? null;
  const userAgent = request.headers.get("user-agent");
  return { ipAddress, userAgent };
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
        { error: "Your account must be approved before approving proofs." },
        { status: 403 }
      );
    }

    const body = (await request.json()) as { confirmationAccepted?: boolean };
    const adminClient = createAdminClient();
    const { ipAddress, userAgent } = extractClientMeta(request);

    await markProofViewed(adminClient, {
      jobId,
      proofId,
      actorProfileId: jobContext.profile.id,
    });

    await approveJobProof(adminClient, {
      jobId,
      proofId,
      actorProfileId: jobContext.profile.id,
      customerEmail: user.email ?? "unknown",
      confirmationAccepted: Boolean(body.confirmationAccepted),
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return proofErrorResponse(error);
  }
}
