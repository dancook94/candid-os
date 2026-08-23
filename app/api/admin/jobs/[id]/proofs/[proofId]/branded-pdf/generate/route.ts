import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { DropboxError } from "@/lib/dropbox/client";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { requireAdminJobAccess } from "@/lib/jobs/auth";
import {
  generateBrandedPdfForExistingProof,
} from "@/lib/proof-generator/service";
import type {
  PreflightManualOverrides,
  PreflightOperatorConfirmation,
} from "@/lib/proof-generator/types";
import { mapDropboxErrorToProofError } from "@/lib/proofs/dropbox-errors";
import { ProofError } from "@/lib/proofs/errors";
import {
  ProofGeneratorTimeoutError,
  proofGeneratorTimeoutMessage,
} from "@/lib/proof-generator/runtime";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string; proofId: string }> };

function proofErrorResponse(error: unknown) {
  if (error instanceof ProofGeneratorTimeoutError) {
    return NextResponse.json(
      { error: proofGeneratorTimeoutMessage(error) },
      { status: 504 }
    );
  }

  if (error instanceof ProofError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof DropboxError) {
    const proofError = mapDropboxErrorToProofError(error, {
      operation: "upload_generated_proof",
      path: "",
    });
    return NextResponse.json(
      { error: proofError.message },
      { status: proofError.status }
    );
  }

  return jobErrorResponse(error);
}

export const maxDuration = 180;

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
      manualOverrides?: PreflightManualOverrides;
      operatorConfirmation?: PreflightOperatorConfirmation;
    };

    const result = await generateBrandedPdfForExistingProof(adminClient, {
      jobId,
      proofId,
      actorProfileId: authResult.userId,
      manualOverrides: body.manualOverrides,
      operatorConfirmation: body.operatorConfirmation,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[proofs:branded-pdf:generate]", error);
    return proofErrorResponse(error);
  }
}
