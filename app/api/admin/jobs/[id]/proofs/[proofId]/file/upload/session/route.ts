import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { requireAdminJobAccess } from "@/lib/jobs/auth";
import { ProofError } from "@/lib/proofs/errors";
import {
  finishStaffProofSourceUpload,
  startStaffProofSourceUpload,
} from "@/lib/proofs/staff-artwork-upload";
import { attachProofFile } from "@/lib/proofs/service";
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

    const body = (await request.json()) as {
      fileName?: string;
      mimeType?: string | null;
      fileSizeBytes?: number;
    };

    const adminClient = createAdminClient();
    const job = await requireAdminJobAccess(adminClient, jobId);

    const result = await startStaffProofSourceUpload(
      {
        id: job.id,
        dropbox_folder_path: job.dropbox_folder_path,
      },
      {
        fileName: body.fileName ?? "",
        mimeType: body.mimeType ?? null,
        fileSizeBytes: Number(body.fileSizeBytes ?? 0),
      }
    );

    return NextResponse.json(result);
  } catch (error) {
    return proofErrorResponse(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
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
      sessionId?: string;
      dropboxPath?: string;
      fileName?: string;
      mimeType?: string | null;
      fileSizeBytes?: number;
    };

    const adminClient = createAdminClient();
    const job = await requireAdminJobAccess(adminClient, jobId);

    const uploadResult = await finishStaffProofSourceUpload({
      job: {
        id: job.id,
        dropbox_folder_path: job.dropbox_folder_path,
      },
      sessionId: body.sessionId ?? "",
      dropboxPath: body.dropboxPath ?? "",
      fileName: body.fileName ?? "",
      mimeType: body.mimeType ?? null,
      fileSizeBytes: Number(body.fileSizeBytes ?? 0),
    });

    await attachProofFile(adminClient, {
      jobId,
      proofId,
      actorProfileId: authResult.userId,
      input: {
        source: "working_file",
        dropboxSourcePath: uploadResult.dropboxPath,
      },
    });

    return NextResponse.json(uploadResult);
  } catch (error) {
    return proofErrorResponse(error);
  }
}
