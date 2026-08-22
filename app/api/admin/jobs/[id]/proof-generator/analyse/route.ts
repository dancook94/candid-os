import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { requireAdminJobAccess } from "@/lib/jobs/auth";
import {
  analyseProofGeneratorArtwork,
} from "@/lib/proof-generator/service";
import type { ArtworkSourceInput } from "@/lib/proof-generator/types";
import { ProofError } from "@/lib/proofs/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

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

    const adminClient = createAdminClient();
    await requireAdminJobAccess(adminClient, jobId);

    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");

      if (!(file instanceof File)) {
        return NextResponse.json({ error: "File upload is required." }, { status: 400 });
      }

      const productionItemIds = JSON.parse(
        String(formData.get("productionItemIds") ?? "[]")
      ) as string[];

      const source: ArtworkSourceInput = {
        type: "upload",
        fileName: file.name,
        mimeType: file.type || null,
      };

      const buffer = Buffer.from(await file.arrayBuffer());
      const preflight = await analyseProofGeneratorArtwork(adminClient, {
        jobId,
        productionItemIds,
        source,
        uploadBuffer: buffer,
      });

      return NextResponse.json({ preflight });
    }

    const body = (await request.json()) as {
      productionItemIds?: string[];
      source?: ArtworkSourceInput;
    };

    if (!body.productionItemIds?.length || !body.source) {
      return NextResponse.json(
        { error: "productionItemIds and source are required." },
        { status: 400 }
      );
    }

    const preflight = await analyseProofGeneratorArtwork(adminClient, {
      jobId,
      productionItemIds: body.productionItemIds,
      source: body.source,
    });

    return NextResponse.json({ preflight });
  } catch (error) {
    return proofErrorResponse(error);
  }
}
