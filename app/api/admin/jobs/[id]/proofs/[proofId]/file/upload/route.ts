import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { requireAdminJobAccess } from "@/lib/jobs/auth";
import { ProofError } from "@/lib/proofs/errors";
import { uploadProofFileToProofsFolder } from "@/lib/proofs/service";
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

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid upload payload." }, { status: 400 });
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A proof file is required." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    await requireAdminJobAccess(adminClient, jobId);

    const result = await uploadProofFileToProofsFolder(adminClient, {
      jobId,
      proofId,
      fileName: file.name,
      mimeType: file.type || null,
      fileBuffer: await file.arrayBuffer(),
      actorProfileId: authResult.userId,
    });

    return NextResponse.json(result);
  } catch (error) {
    return proofErrorResponse(error);
  }
}
