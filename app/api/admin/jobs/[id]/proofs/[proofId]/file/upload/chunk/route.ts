import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { requireAdminJobAccess } from "@/lib/jobs/auth";
import { ProofError } from "@/lib/proofs/errors";
import { appendStaffProofSourceUploadChunk } from "@/lib/proofs/staff-artwork-upload";
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
    const { id: jobId } = await context.params;
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

    const chunk = formData.get("chunk");
    if (!(chunk instanceof Blob)) {
      return NextResponse.json({ error: "Upload chunk is required." }, { status: 400 });
    }

    const sessionId = String(formData.get("sessionId") ?? "").trim();
    const dropboxPath = String(formData.get("dropboxPath") ?? "").trim();
    const offset = Number.parseInt(String(formData.get("offset") ?? ""), 10);

    if (!sessionId || !dropboxPath || !Number.isFinite(offset)) {
      return NextResponse.json({ error: "Upload session details are required." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const job = await requireAdminJobAccess(adminClient, jobId);

    const result = await appendStaffProofSourceUploadChunk({
      job: {
        id: job.id,
        dropbox_folder_path: job.dropbox_folder_path,
      },
      sessionId,
      dropboxPath,
      offset,
      chunk: await chunk.arrayBuffer(),
    });

    return NextResponse.json(result);
  } catch (error) {
    return proofErrorResponse(error);
  }
}
