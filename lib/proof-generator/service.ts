import type { SupabaseClient } from "@supabase/supabase-js";

import { downloadDropboxFile } from "@/lib/dropbox/client";
import { analyseImageBuffer } from "@/lib/proof-generator/analyse-image";
import { analysePdfBuffer } from "@/lib/proof-generator/analyse-pdf";
import {
  formatProofGeneratorMaxAnalysisLabel,
  getProofGeneratorMaxAnalysisBytes,
  PROOF_GENERATOR_OVERSIZE_MESSAGE,
  PROOF_GENERATOR_UNSUPPORTED_MESSAGE,
} from "@/lib/proof-generator/constants";
import {
  buildGeneratedProofFileName,
  generateCustomerProofPdf,
} from "@/lib/proof-generator/generate-proof-pdf";
import type {
  ArtworkSourceInput,
  GenerateProofInput,
  PreflightManualOverrides,
  PreflightResult,
  QuotedSpecificationItem,
} from "@/lib/proof-generator/types";
import { buildPreflightResult } from "@/lib/proof-generator/warnings";
import { ProofError } from "@/lib/proofs/errors";
import { getFileExtension, isProductionArtworkExtension } from "@/lib/proofs/file-validation";
import {
  createJobProof,
  uploadProofFileToProofsFolder,
} from "@/lib/proofs/service";
import { PROOF_ACTIVITY_TYPES } from "@/lib/proofs/constants";
import { logProofActivity } from "@/lib/proofs/activity";
import { revalidateJobPages } from "@/lib/jobs/revalidation";

function assertAnalysisSize(buffer: Buffer) {
  const maxBytes = getProofGeneratorMaxAnalysisBytes();

  if (buffer.length > maxBytes) {
    throw new ProofError(
      `${PROOF_GENERATOR_OVERSIZE_MESSAGE} (limit: ${formatProofGeneratorMaxAnalysisLabel()}).`,
      413
    );
  }
}

function assertSupportedExtension(fileName: string) {
  const extension = getFileExtension(fileName);

  if (extension === "ai" || isProductionArtworkExtension(fileName)) {
    throw new ProofError(PROOF_GENERATOR_UNSUPPORTED_MESSAGE, 400);
  }

  if (!["pdf", "jpg", "jpeg", "png"].includes(extension)) {
    throw new ProofError(
      "Only PDF, JPG, and PNG files are supported for automated proof generation.",
      400
    );
  }
}

async function loadQuotedSpecificationItems(
  adminClient: SupabaseClient,
  jobId: string,
  productionItemIds: string[]
): Promise<QuotedSpecificationItem[]> {
  const { data, error } = await adminClient
    .from("production_items")
    .select(
      "id, item_reference, item_name, description, quantity, width_mm, height_mm, material, media_profile, machine, sides, finishing_notes, internal_note"
    )
    .eq("job_id", jobId)
    .in("id", productionItemIds)
    .is("deleted_at", null);

  if (error) {
    throw new ProofError(error.message, 500);
  }

  if ((data ?? []).length !== productionItemIds.length) {
    throw new ProofError("One or more manifest items were not found on this job.", 404);
  }

  return (data ?? []).map((item) => ({
    id: item.id as string,
    itemReference: (item.item_reference as string | null) ?? null,
    itemName: item.item_name as string,
    description: (item.description as string | null) ?? null,
    quantity: (item.quantity as number | null) ?? null,
    quotedWidthMm: (item.width_mm as number | null) ?? null,
    quotedHeightMm: (item.height_mm as number | null) ?? null,
    material: (item.material as string | null) ?? null,
    printSpecification: [item.material, item.media_profile, item.machine]
      .filter(Boolean)
      .join(" · ") || null,
    sides: (item.sides as string | null) ?? null,
    finishing: (item.finishing_notes as string | null) ?? null,
    notes: (item.internal_note as string | null) ?? null,
  }));
}

async function resolveArtworkBuffer(
  adminClient: SupabaseClient,
  jobId: string,
  source: ArtworkSourceInput,
  uploadBuffer?: Buffer
) {
  if (source.type === "upload") {
    if (!uploadBuffer) {
      throw new ProofError("Uploaded file data is missing.", 400);
    }

    assertSupportedExtension(source.fileName);
    assertAnalysisSize(uploadBuffer);

    return {
      buffer: uploadBuffer,
      fileName: source.fileName,
      mimeType: source.mimeType,
      dropboxPath: null as string | null,
      jobFileId: null as string | null,
    };
  }

  if (source.type === "dropbox_path") {
    assertSupportedExtension(source.fileName);
    const downloaded = await downloadDropboxFile(source.dropboxPath);
    assertAnalysisSize(downloaded.buffer);

    return {
      buffer: downloaded.buffer,
      fileName: source.fileName || downloaded.fileName,
      mimeType: downloaded.contentType,
      dropboxPath: source.dropboxPath,
      jobFileId: null as string | null,
    };
  }

  const { data: jobFile, error } = await adminClient
    .from("job_files")
    .select("id, file_name, mime_type, dropbox_path")
    .eq("job_id", jobId)
    .eq("id", source.jobFileId)
    .maybeSingle();

  if (error || !jobFile) {
    throw new ProofError("Source artwork file was not found.", 404);
  }

  const dropboxPath = jobFile.dropbox_path as string | null;
  if (!dropboxPath) {
    throw new ProofError("Source artwork is not available in Dropbox.", 409);
  }

  const fileName = jobFile.file_name as string;
  assertSupportedExtension(fileName);
  const downloaded = await downloadDropboxFile(dropboxPath);
  assertAnalysisSize(downloaded.buffer);

  return {
    buffer: downloaded.buffer,
    fileName,
    mimeType: (jobFile.mime_type as string | null) ?? downloaded.contentType,
    dropboxPath,
    jobFileId: jobFile.id as string,
  };
}

export async function analyseProofGeneratorArtwork(
  adminClient: SupabaseClient,
  {
    jobId,
    productionItemIds,
    source,
    uploadBuffer,
  }: {
    jobId: string;
    productionItemIds: string[];
    source: ArtworkSourceInput;
    uploadBuffer?: Buffer;
  }
): Promise<PreflightResult> {
  if (!productionItemIds.length) {
    throw new ProofError("Select at least one production item.", 400);
  }

  const [quotedItems, artwork] = await Promise.all([
    loadQuotedSpecificationItems(adminClient, jobId, productionItemIds),
    resolveArtworkBuffer(adminClient, jobId, source, uploadBuffer),
  ]);

  const extension = getFileExtension(artwork.fileName);
  const metadata =
    extension === "pdf"
      ? await analysePdfBuffer(artwork.buffer, artwork.fileName, artwork.mimeType)
      : await analyseImageBuffer(artwork.buffer, artwork.fileName, artwork.mimeType);

  return buildPreflightResult({
    metadata,
    quotedItems,
    sourceReference: {
      dropboxPath: artwork.dropboxPath,
      fileName: artwork.fileName,
      fileSizeBytes: artwork.buffer.length,
      mimeType: artwork.mimeType,
    },
  });
}

export async function saveProofPreflightRecord(
  adminClient: SupabaseClient,
  {
    proofId,
    preflight,
    manualOverrides,
    sourceDropboxPath,
    reviewedByProfileId,
  }: {
    proofId: string;
    preflight: PreflightResult;
    manualOverrides?: PreflightManualOverrides;
    sourceDropboxPath?: string | null;
    reviewedByProfileId?: string | null;
  }
) {
  const payload = {
    proof_id: proofId,
    source_dropbox_path: sourceDropboxPath ?? preflight.sourceReference.dropboxPath,
    analysis_version: preflight.analysisVersion,
    overall_status: preflight.overallStatus,
    detected_metadata: preflight.metadata,
    checks: preflight.checks,
    manual_overrides: manualOverrides ?? {},
    reviewed_by_profile_id: reviewedByProfileId ?? null,
    reviewed_at: reviewedByProfileId ? new Date().toISOString() : null,
    metadata: {
      sizeComparison: preflight.sizeComparison,
      quotedItems: preflight.quotedItems,
      sourceReference: preflight.sourceReference,
    },
    updated_at: new Date().toISOString(),
  };

  const { error } = await adminClient.from("job_proof_preflight").upsert(payload, {
    onConflict: "proof_id",
  });

  if (error) {
    if (error.code === "42703" || error.code === "42P01") {
      return { saved: false, schemaMissing: true as const };
    }

    throw new ProofError(error.message, 500);
  }

  return { saved: true, schemaMissing: false as const };
}

export async function generateProofFromPreflight(
  adminClient: SupabaseClient,
  input: GenerateProofInput & {
    actorProfileId: string;
    sourceBuffer: Buffer;
    sourceDropboxPath?: string | null;
    sourceJobFileId?: string | null;
  }
) {
  const {
    jobId,
    actorProfileId,
    productionItemIds,
    title,
    customerMessage,
    internalNote,
    artworkOrigin,
    preflightResult,
    manualOverrides,
    sourceBuffer,
    sourceDropboxPath,
    sourceJobFileId,
  } = input;

  const { data: job } = await adminClient
    .from("jobs")
    .select("company_id, quote_id, opportunity_id, job_reference, project_name")
    .eq("id", jobId)
    .maybeSingle();

  if (!job) {
    throw new ProofError("Job not found.", 404);
  }

  const proof = await createJobProof(adminClient, {
    jobId,
    actorProfileId,
    input: {
      title,
      artworkOrigin,
      customerMessage,
      internalNote,
      productionItemIds,
    },
  });

  const generatedPdf = await generateCustomerProofPdf({
    jobReference: job.job_reference as string,
    projectName: job.project_name as string,
    proofReference: proof.proof_reference,
    versionNumber: proof.version_number,
    customerMessage,
    preflight: preflightResult,
    sourceBuffer,
  });

  const generatedFileName = buildGeneratedProofFileName(
    proof.proof_reference,
    proof.version_number
  );

  await uploadProofFileToProofsFolder(adminClient, {
    jobId,
    proofId: proof.id,
    fileName: generatedFileName,
    mimeType: "application/pdf",
    fileBuffer: generatedPdf.buffer.slice(
      generatedPdf.byteOffset,
      generatedPdf.byteOffset + generatedPdf.byteLength
    ),
    actorProfileId,
  });

  await saveProofPreflightRecord(adminClient, {
    proofId: proof.id,
    preflight: preflightResult,
    manualOverrides,
    sourceDropboxPath,
    reviewedByProfileId: actorProfileId,
  });

  if (job) {
    await logProofActivity(adminClient, {
      activityType: PROOF_ACTIVITY_TYPES.proofCreated,
      description: `Generated proof ${proof.proof_reference} with automated preflight.`,
      companyId: job.company_id as string,
      quoteId: job.quote_id as string,
      opportunityId: job.opportunity_id as string | null,
      actorProfileId,
      metadata: {
        job_id: jobId,
        proof_id: proof.id,
        generator: true,
        overall_status: preflightResult.overallStatus,
      },
    });

    revalidateJobPages({
      jobId,
      quoteId: job.quote_id as string,
      opportunityId: job.opportunity_id as string | null,
    });
  }

  return proof;
}

export { loadQuotedSpecificationItems, resolveArtworkBuffer as resolveArtworkBufferForGenerator };
