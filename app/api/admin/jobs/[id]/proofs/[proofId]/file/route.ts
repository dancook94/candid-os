import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { requireAdminJobAccess } from "@/lib/jobs/auth";
import { ProofError } from "@/lib/proofs/errors";
import { attachProofFile, removeProofFile } from "@/lib/proofs/service";
import type { AttachProofFileInput } from "@/lib/proofs/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string; proofId: string }> };

function proofErrorResponse(error: unknown) {
  if (error instanceof ProofError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return jobErrorResponse(error);
}

export async function PATCH(request: Request, context: RouteContext) {
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
      source?: AttachProofFileInput["source"];
      sourceJobFileId?: string;
      dropboxSourcePath?: string;
    };

    if (
      !body.source ||
      !["customer_artwork", "working_file", "proofs_folder"].includes(body.source)
    ) {
      return NextResponse.json({ error: "Invalid proof file source." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    await requireAdminJobAccess(adminClient, jobId);

    await attachProofFile(adminClient, {
      jobId,
      proofId,
      actorProfileId: authResult.userId,
      input: {
        source: body.source,
        sourceJobFileId: body.sourceJobFileId,
        dropboxSourcePath: body.dropboxSourcePath,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return proofErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
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

    await removeProofFile(adminClient, {
      jobId,
      proofId,
      actorProfileId: authResult.userId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return proofErrorResponse(error);
  }
}
