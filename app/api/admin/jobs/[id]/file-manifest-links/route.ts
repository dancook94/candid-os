import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { requireAdminJobAccess } from "@/lib/jobs/auth";
import { ProofError } from "@/lib/proofs/errors";
import { linkJobFileToManifestItems } from "@/lib/proofs/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

function proofErrorResponse(error: unknown) {
  if (error instanceof ProofError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return jobErrorResponse(error);
}

export async function POST(request: Request, context: RouteContext) {
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
      jobFileId?: string;
      productionItemIds?: string[];
    };

    if (!body.jobFileId || !body.productionItemIds?.length) {
      return NextResponse.json(
        { error: "jobFileId and productionItemIds are required." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();
    await requireAdminJobAccess(adminClient, jobId);

    const result = await linkJobFileToManifestItems(adminClient, {
      jobId,
      jobFileId: body.jobFileId,
      productionItemIds: body.productionItemIds,
      actorProfileId: authResult.userId,
    });

    return NextResponse.json(result);
  } catch (error) {
    return proofErrorResponse(error);
  }
}
