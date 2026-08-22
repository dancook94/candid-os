import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { requireAdminJobAccess } from "@/lib/jobs/auth";
import type { ProofInternalChecklistKey } from "@/lib/proofs/constants";
import { ProofError } from "@/lib/proofs/errors";
import {
  markProofReadyToSend,
  resendProofReadyNotification,
  sendJobProof,
  submitProofInternalReview,
} from "@/lib/proofs/service";
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

    const body = (await request.json()) as {
      action?: string;
      checklist?: Partial<Record<ProofInternalChecklistKey, boolean>>;
    };

    const adminClient = createAdminClient();
    await requireAdminJobAccess(adminClient, jobId);

    switch (body.action) {
      case "submit_internal_review":
        await submitProofInternalReview(adminClient, {
          jobId,
          proofId,
          checklist: body.checklist ?? {},
          actorProfileId: authResult.userId,
        });
        break;
      case "mark_ready_to_send":
        await markProofReadyToSend(adminClient, {
          jobId,
          proofId,
          actorProfileId: authResult.userId,
        });
        break;
      case "send":
        await sendJobProof(adminClient, {
          jobId,
          proofId,
          actorProfileId: authResult.userId,
        });
        break;
      case "resend_notification":
        await resendProofReadyNotification(adminClient, {
          jobId,
          proofId,
          actorProfileId: authResult.userId,
        });
        break;
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return proofErrorResponse(error);
  }
}
