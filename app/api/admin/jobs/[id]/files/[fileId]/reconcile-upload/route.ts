import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { reconcileArtworkUploadRecordOrThrow } from "@/lib/jobs/reconcile-artwork-upload";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string; fileId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id: jobId, fileId } = await context.params;
    const supabase = await createClient();
    const authResult = await verifyApprovedAdmin(supabase);

    if (!authResult.ok) {
      return NextResponse.json(
        { error: authResult.message },
        { status: authResult.status }
      );
    }

    const adminClient = createAdminClient();
    const { data: file, error: fileError } = await adminClient
      .from("job_files")
      .select("id, job_id")
      .eq("id", fileId)
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .maybeSingle();

    if (fileError) {
      return NextResponse.json({ error: fileError.message }, { status: 500 });
    }

    if (!file) {
      return NextResponse.json({ error: "Artwork file not found." }, { status: 404 });
    }

    const result = await reconcileArtworkUploadRecordOrThrow(adminClient, {
      jobFileId: fileId,
      actorProfileId: authResult.userId,
      trigger: "admin_artwork_upload_reconciliation",
    });

    return NextResponse.json({
      ok: result.ok,
      jobFileId: result.jobFileId,
      jobId: result.jobId,
      updated: result.updated,
      dropboxVerified: result.dropboxVerified,
      jobStatusUpdated: result.jobStatusUpdated,
      previousUploadStatus: result.previousUploadStatus,
    });
  } catch (error) {
    return jobErrorResponse(error);
  }
}
