import { NextResponse } from "next/server";

import { downloadDropboxFile } from "@/lib/dropbox/client";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { requireCustomerJobContext } from "@/lib/jobs/auth";
import { ProofError } from "@/lib/proofs/errors";
import { markProofViewed } from "@/lib/proofs/service";
import { PROOF_FILE_SELECT, PROOF_SELECT } from "@/lib/proofs/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string; proofId: string }> };

function proofErrorResponse(error: unknown) {
  if (error instanceof ProofError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return jobErrorResponse(error);
}

async function loadCustomerVisibleProofFile(
  adminClient: ReturnType<typeof createAdminClient>,
  jobId: string,
  proofId: string
) {
  const { data: proof, error } = await adminClient
    .from("job_proofs")
    .select(PROOF_SELECT)
    .eq("id", proofId)
    .eq("job_id", jobId)
    .maybeSingle();

  if (error || !proof) {
    throw new ProofError("Proof not found.", 404);
  }

  if (["draft", "internal_review", "ready_to_send", "cancelled"].includes(proof.status)) {
    throw new ProofError("Proof is not available.", 403);
  }

  const { data: proofFile, error: fileError } = await adminClient
    .from("job_proof_files")
    .select(PROOF_FILE_SELECT)
    .eq("proof_id", proofId)
    .limit(1)
    .maybeSingle();

  if (fileError || !proofFile?.dropbox_path) {
    throw new ProofError("Proof file is not ready to download.", 409);
  }

  return { proof, proofFile };
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
    const { proof, proofFile } = await loadCustomerVisibleProofFile(
      adminClient,
      jobId,
      proofId
    );

    await markProofViewed(adminClient, {
      jobId,
      proofId,
      actorProfileId: jobContext.profile.id,
    });

    const downloaded = await downloadDropboxFile(proofFile.dropbox_path);

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

    await loadCustomerVisibleProofFile(adminClient, jobId, proofId);

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
