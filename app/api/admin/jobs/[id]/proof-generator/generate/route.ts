import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { jobErrorResponse } from "@/lib/jobs/api-response";
import { requireAdminJobAccess } from "@/lib/jobs/auth";
import {
  analyseProofGeneratorArtwork,
  generateProofFromPreflight,
  resolveArtworkBufferForGenerator,
} from "@/lib/proof-generator/service";
import type {
  ArtworkSourceInput,
  PreflightManualOverrides,
  PreflightResult,
} from "@/lib/proof-generator/types";
import type { ProofArtworkOrigin, ProofInternalChecklistKey } from "@/lib/proofs/constants";
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
      const productionItemIds = JSON.parse(
        String(formData.get("productionItemIds") ?? "[]")
      ) as string[];
      const preflight = JSON.parse(String(formData.get("preflight") ?? "null")) as PreflightResult | null;
      const title = String(formData.get("title") ?? "").trim();
      const customerMessage = String(formData.get("customerMessage") ?? "").trim() || null;
      const internalNote = String(formData.get("internalNote") ?? "").trim() || null;
      const artworkOrigin = (String(formData.get("artworkOrigin") ?? "customer_uploaded") ||
        "customer_uploaded") as ProofArtworkOrigin;

      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Source artwork file is required." }, { status: 400 });
      }

      if (!title) {
        return NextResponse.json({ error: "Proof title is required." }, { status: 400 });
      }

      const source: ArtworkSourceInput = {
        type: "upload",
        fileName: file.name,
        mimeType: file.type || null,
      };

      const buffer = Buffer.from(await file.arrayBuffer());
      const resolvedPreflight =
        preflight?.analysisVersion
          ? preflight
          : await analyseProofGeneratorArtwork(adminClient, {
              jobId,
              productionItemIds,
              source,
              uploadBuffer: buffer,
            });

      const proof = await generateProofFromPreflight(adminClient, {
        jobId,
        actorProfileId: authResult.userId,
        productionItemIds,
        title,
        customerMessage,
        internalNote,
        artworkOrigin,
        preflightResult: resolvedPreflight,
        sourceBuffer: buffer,
        sourceDropboxPath: null,
        sourceJobFileId: null,
      });

      return NextResponse.json({ proof });
    }

    const body = (await request.json()) as {
      productionItemIds?: string[];
      source?: ArtworkSourceInput;
      preflight?: PreflightResult;
      title?: string;
      customerMessage?: string | null;
      internalNote?: string | null;
      artworkOrigin?: ProofArtworkOrigin;
      manualOverrides?: PreflightManualOverrides;
      warningsReviewed?: Partial<Record<string, boolean>>;
      checklistAcknowledgements?: Partial<Record<ProofInternalChecklistKey, boolean>>;
    };

    if (!body.productionItemIds?.length || !body.source || !body.title?.trim()) {
      return NextResponse.json(
        { error: "productionItemIds, source, and title are required." },
        { status: 400 }
      );
    }

    const artwork = await resolveArtworkBufferForGenerator(
      adminClient,
      jobId,
      body.source
    );

    const preflight =
      body.preflight?.analysisVersion
        ? body.preflight
        : await analyseProofGeneratorArtwork(adminClient, {
            jobId,
            productionItemIds: body.productionItemIds,
            source: body.source,
          });

    const proof = await generateProofFromPreflight(adminClient, {
      jobId,
      actorProfileId: authResult.userId,
      productionItemIds: body.productionItemIds,
      title: body.title.trim(),
      customerMessage: body.customerMessage,
      internalNote: body.internalNote,
      artworkOrigin: body.artworkOrigin ?? "customer_uploaded",
      preflightResult: preflight,
      manualOverrides: body.manualOverrides,
      warningsReviewed: body.warningsReviewed,
      checklistAcknowledgements: body.checklistAcknowledgements,
      sourceBuffer: artwork.buffer,
      sourceDropboxPath: artwork.dropboxPath,
      sourceJobFileId: artwork.jobFileId,
    });

    return NextResponse.json({ proof });
  } catch (error) {
    return proofErrorResponse(error);
  }
}
