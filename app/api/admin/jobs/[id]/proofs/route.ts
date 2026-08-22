import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { requireAdminJobAccess } from "@/lib/jobs/auth";
import type { ProofArtworkOrigin } from "@/lib/proofs/constants";
import { ProofError } from "@/lib/proofs/errors";
import { listProofSourceDropboxFiles } from "@/lib/proofs/dropbox";
import { createJobProof, loadProofsForJob } from "@/lib/proofs/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

function proofErrorResponse(error: unknown) {
  if (error instanceof ProofError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return jobErrorResponse(error);
}

export async function GET(_request: Request, context: RouteContext) {
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

    const adminClient = createAdminClient();
    await requireAdminJobAccess(adminClient, jobId);
    const result = await loadProofsForJob(adminClient, jobId);

    return NextResponse.json(result);
  } catch (error) {
    return proofErrorResponse(error);
  }
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
      title?: string;
      artworkOrigin?: ProofArtworkOrigin;
      customerMessage?: string;
      internalNote?: string;
      productionItemIds?: string[];
      sourceJobFileId?: string;
      dropboxSourcePath?: string;
      dropboxFileName?: string;
    };

    const adminClient = createAdminClient();
    await requireAdminJobAccess(adminClient, jobId);

    const proof = await createJobProof(adminClient, {
      jobId,
      actorProfileId: authResult.userId,
      input: {
        title: body.title ?? "",
        artworkOrigin: body.artworkOrigin ?? "customer_uploaded",
        customerMessage: body.customerMessage,
        internalNote: body.internalNote,
        productionItemIds: body.productionItemIds ?? [],
        sourceJobFileId: body.sourceJobFileId,
        dropboxSourcePath: body.dropboxSourcePath,
        dropboxFileName: body.dropboxFileName,
      },
    });

    return NextResponse.json({ ok: true, proof });
  } catch (error) {
    return proofErrorResponse(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
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

    const body = (await request.json()) as { artworkOrigin?: ProofArtworkOrigin };
    const adminClient = createAdminClient();
    const job = await requireAdminJobAccess(adminClient, jobId);

    const files = await listProofSourceDropboxFiles(
      body.artworkOrigin ?? "customer_uploaded",
      job.job_reference,
      job.project_name
    );

    return NextResponse.json({ files });
  } catch (error) {
    return proofErrorResponse(error);
  }
}
