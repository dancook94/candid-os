import { NextResponse } from "next/server";

import { downloadDropboxFile } from "@/lib/dropbox/client";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { requireCustomerJobContext } from "@/lib/jobs/auth";
import { ProofError } from "@/lib/proofs/errors";
import { markProofViewed, loadCustomerProofDownloadFile } from "@/lib/proofs/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string; proofId: string }> };

function proofErrorResponse(error: unknown) {
  if (error instanceof ProofError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return jobErrorResponse(error);
}

export async function GET(
  _request: Request,
  context: RouteContext
) {
  try {
    const { id: jobId, proofId } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const jobContext = await requireCustomerJobContext(supabase, user, jobId);
    const adminClient = createAdminClient();
    const { proofFile } = await loadCustomerProofDownloadFile(adminClient, {
      jobId,
      proofId,
      customerVisible: true,
    });

    await markProofViewed(adminClient, {
      jobId,
      proofId,
      actorProfileId: jobContext.profile.id,
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

export async function POST(
  _request: Request,
  context: RouteContext
) {
  try {
    const { id: jobId, proofId } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const jobContext = await requireCustomerJobContext(supabase, user, jobId);
    const adminClient = createAdminClient();

    await loadCustomerProofDownloadFile(adminClient, {
      jobId,
      proofId,
      customerVisible: true,
    });

    await markProofViewed(adminClient, {
      jobId,
      proofId,
      actorProfileId: jobContext.profile.id,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return proofErrorResponse(error);
  }
}
