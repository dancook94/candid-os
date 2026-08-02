import { NextResponse } from "next/server";

import { requireCustomerJobContext } from "@/lib/jobs/auth";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import {
  appendArtworkUploadChunk,
  cancelArtworkUpload,
  finishArtworkUpload,
} from "@/lib/jobs/upload-service";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const { id: jobId, fileId } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const jobContext = await requireCustomerJobContext(supabase, user, jobId);
    const formData = await request.formData();
    const chunk = formData.get("chunk");

    if (!(chunk instanceof Blob)) {
      return NextResponse.json({ error: "Upload chunk is required." }, { status: 400 });
    }

    const progress = await appendArtworkUploadChunk(
      jobContext,
      fileId,
      await chunk.arrayBuffer()
    );

    return NextResponse.json(progress);
  } catch (error) {
    return jobErrorResponse(error);
  }
}

export async function PUT(
  _request: Request,
  context: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const { id: jobId, fileId } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const jobContext = await requireCustomerJobContext(supabase, user, jobId);
    const file = await finishArtworkUpload(jobContext, fileId);

    return NextResponse.json({
      success: true,
      fileId: file.id,
      uploadStatus: file.upload_status,
      artworkStatus: file.artwork_status,
    });
  } catch (error) {
    return jobErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const { id: jobId, fileId } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const jobContext = await requireCustomerJobContext(supabase, user, jobId);
    await cancelArtworkUpload(jobContext, fileId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return jobErrorResponse(error);
  }
}
