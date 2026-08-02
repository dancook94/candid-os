import { NextResponse } from "next/server";

import { requireCustomerJobContext } from "@/lib/jobs/auth";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { createArtworkUploadSession } from "@/lib/jobs/upload-service";
import { getJobArtworkChunkBytes } from "@/lib/jobs/constants";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const jobContext = await requireCustomerJobContext(supabase, user, jobId);
    const body = (await request.json()) as {
      fileName?: string;
      mimeType?: string | null;
      fileSizeBytes?: number;
      customerNotes?: string | null;
      supersedesFileId?: string | null;
    };

    const result = await createArtworkUploadSession(jobContext, {
      fileName: body.fileName ?? "",
      mimeType: body.mimeType,
      fileSizeBytes: Number(body.fileSizeBytes ?? 0),
      customerNotes: body.customerNotes,
      supersedesFileId: body.supersedesFileId,
    });

    if (!result.file?.id) {
      return NextResponse.json(
        { error: "Artwork record could not be created." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      fileId: result.file.id,
      sessionId: result.sessionId,
      chunkSizeBytes: getJobArtworkChunkBytes(),
      uploadedBytes: 0,
      totalBytes: result.file.file_size_bytes,
    });
  } catch (error) {
    return jobErrorResponse(error);
  }
}
