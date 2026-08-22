import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { downloadDropboxFile } from "@/lib/dropbox/client";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { requireAdminJobAccess } from "@/lib/jobs/auth";
import { ProofError } from "@/lib/proofs/errors";
import { loadCustomerProofDownloadFile } from "@/lib/proofs/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string; proofId: string }> };

function proofErrorResponse(error: unknown) {
  if (error instanceof ProofError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return jobErrorResponse(error);
}

export async function GET(_request: Request, context: RouteContext) {
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

    const { proofFile } = await loadCustomerProofDownloadFile(adminClient, {
      jobId,
      proofId,
    });

    const downloaded = await downloadDropboxFile(proofFile.dropbox_path as string);

    return new NextResponse(new Uint8Array(downloaded.buffer), {
      headers: {
        "Content-Type": downloaded.contentType,
        "Content-Disposition": `attachment; filename="${proofFile.file_name}"`,
      },
    });
  } catch (error) {
    return proofErrorResponse(error);
  }
}
