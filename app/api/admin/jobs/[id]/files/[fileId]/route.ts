import { NextResponse } from "next/server";

import { verifyApprovedCrmStaff } from "@/lib/crm-auth";
import { downloadDropboxFile } from "@/lib/dropbox/client";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { requireAdminJobAccess } from "@/lib/jobs/auth";
import { updateArtworkReviewStatus } from "@/lib/jobs/review-service";
import type { JobArtworkStatus } from "@/lib/jobs/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const { id: jobId, fileId } = await context.params;
    const supabase = await createClient();
    const auth = await verifyApprovedCrmStaff(supabase);

    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status });
    }

    const body = (await request.json()) as {
      artworkStatus?: JobArtworkStatus;
      changesRequiredComment?: string | null;
      internalNotes?: string | null;
    };

    if (!body.artworkStatus) {
      return NextResponse.json({ error: "Artwork status is required." }, { status: 400 });
    }

    await updateArtworkReviewStatus({
      jobId,
      fileId,
      artworkStatus: body.artworkStatus,
      actorProfileId: auth.userId,
      changesRequiredComment: body.changesRequiredComment,
      internalNotes: body.internalNotes,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return jobErrorResponse(error);
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const { id: jobId, fileId } = await context.params;
    const supabase = await createClient();
    const auth = await verifyApprovedCrmStaff(supabase);

    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status });
    }

    const adminClient = createAdminClient();
    await requireAdminJobAccess(adminClient, jobId);

    const { data: file, error } = await adminClient
      .from("job_files")
      .select("*")
      .eq("id", fileId)
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error || !file || !file.dropbox_path_lower) {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }

    const downloaded = await downloadDropboxFile(file.dropbox_path_lower);

    return new NextResponse(new Uint8Array(downloaded.buffer), {
      headers: {
        "Content-Type": downloaded.contentType,
        "Content-Disposition": `attachment; filename="${file.file_name}"`,
      },
    });
  } catch (error) {
    return jobErrorResponse(error);
  }
}
