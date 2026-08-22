import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { requireAdminJobAccess } from "@/lib/jobs/auth";
import { ProofError } from "@/lib/proofs/errors";
import {
  loadJobProofRequirement,
  loadProofsForJob,
  updateJobProofRequirement,
} from "@/lib/proofs/service";
import type { ProofBypassReason } from "@/lib/proofs/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function loadBypassedByName(
  adminClient: ReturnType<typeof createAdminClient>,
  profileId: string | null | undefined
) {
  if (!profileId) {
    return null;
  }

  const { data } = await adminClient
    .from("profiles")
    .select("full_name, email")
    .eq("id", profileId)
    .maybeSingle();

  const fullName = data?.full_name?.trim();
  return fullName || data?.email || null;
}

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
    const authResult = await verifyApprovedAdmin(supabase);

    if (!authResult.ok) {
      return NextResponse.json(
        { error: authResult.message },
        { status: authResult.status }
      );
    }

    const adminClient = createAdminClient();
    await requireAdminJobAccess(adminClient, jobId);

    const [requirement, proofsResult] = await Promise.all([
      loadJobProofRequirement(adminClient, jobId),
      loadProofsForJob(adminClient, jobId),
    ]);

    const bypassedByName = await loadBypassedByName(
      adminClient,
      requirement.bypassedByProfileId
    );

    return NextResponse.json({
      requirement: {
        ...requirement,
        bypassedByName,
      },
      proofs: proofsResult.proofs,
      schemaMissing: proofsResult.schemaMissing || requirement.schemaMissing,
    });
  } catch (error) {
    return proofErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id: jobId } = await context.params;
    const supabase = await createClient();
    const authResult = await verifyApprovedAdmin(supabase);

    if (!authResult.ok) {
      return NextResponse.json(
        { error: authResult.message },
        { status: authResult.status }
      );
    }

    const body = (await request.json()) as {
      proofRequired?: boolean;
      bypassReason?: ProofBypassReason;
    };

    if (typeof body.proofRequired !== "boolean") {
      return NextResponse.json({ error: "proofRequired is required." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    await requireAdminJobAccess(adminClient, jobId);

    const result = await updateJobProofRequirement(adminClient, {
      jobId,
      proofRequired: body.proofRequired,
      bypassReason: body.bypassReason ?? null,
      actorProfileId: authResult.userId,
    });

    return NextResponse.json(result);
  } catch (error) {
    return proofErrorResponse(error);
  }
}
