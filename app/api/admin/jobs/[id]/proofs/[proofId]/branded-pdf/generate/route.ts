import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { requireAdminJobAccess } from "@/lib/jobs/auth";
import {
  analyseExistingProofArtwork,
  generateBrandedPdfForExistingProof,
} from "@/lib/proof-generator/service";
import type {
  PreflightManualOverrides,
  PreflightResult,
} from "@/lib/proof-generator/types";
import { ProofError } from "@/lib/proofs/errors";
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
    const authResult = await verifyApprovedAdmin(supabase);

    if (!authResult.ok) {
      return NextResponse.json(
        { error: authResult.message },
        { status: authResult.status }
      );
    }

    const adminClient = createAdminClient();
    await requireAdminJobAccess(adminClient, jobId);

    const body = (await request.json()) as {
      preflight?: PreflightResult;
      manualOverrides?: PreflightManualOverrides;
    };

    const preflight =
      body.preflight?.analysisVersion
        ? body.preflight
        : await analyseExistingProofArtwork(adminClient, jobId, proofId);

    const result = await generateBrandedPdfForExistingProof(adminClient, {
      jobId,
      proofId,
      actorProfileId: authResult.userId,
      preflightResult: preflight,
      manualOverrides: body.manualOverrides,
    });

    return NextResponse.json(result);
  } catch (error) {
    return proofErrorResponse(error);
  }
}
