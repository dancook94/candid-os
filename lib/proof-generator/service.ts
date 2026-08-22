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
import { generateCustomerProofPdf } from "@/lib/proof-generator/generate-proof-pdf";
import type {
  PreflightManualOverrides,
  PreflightResult,
  QuotedSpecificationItem,
} from "@/lib/proof-generator/types";
import { buildPreflightResult } from "@/lib/proof-generator/warnings";
import { PROOF_ACTIVITY_TYPES, PROOF_SELECT } from "@/lib/proofs/constants";
import { ProofError } from "@/lib/proofs/errors";
import { getFileExtension } from "@/lib/proofs/file-validation";
import { logProofActivity } from "@/lib/proofs/activity";
import { revalidateJobPages } from "@/lib/jobs/revalidation";
import { uploadProofFileToProofsFolder } from "@/lib/proofs/service";

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

  if (extension === "ai") {
    throw new ProofError(PROOF_GENERATOR_UNSUPPORTED_MESSAGE, 400);
  }

  if (!["pdf", "jpg", "jpeg", "png"].includes(extension)) {
    throw new ProofError(
      "Only PDF, JPG, and PNG files are supported for automated proof generation.",
      400
    );
  }
}

async function loadMutableProofRecord(
  adminClient: SupabaseClient,
  jobId: string,
  proofId: string
) {
  const { data, error } = await adminClient
    .from("job_proofs")
    .select(PROOF_SELECT)
    .eq("id", proofId)
    .eq("job_id", jobId)
    .maybeSingle();

  if (error || !data) {
    throw new ProofError("Proof not found.", 404);
  }

  if (
    ["sent", "viewed", "approved", "changes_requested", "superseded", "cancelled"].includes(
      data.status as string
    )
  ) {
    throw new ProofError("This proof version can no longer be edited.", 409);
  }

  return data;
}

async function loadProofProductionItemIds(
  adminClient: SupabaseClient,
  proofId: string
) {
  const { data, error } = await adminClient
    .from("job_proof_manifest_items")
    .select("production_item_id")
    .eq("proof_id", proofId);

  if (error) {
    throw new ProofError(error.message, 500);
  }

  const productionItemIds = (data ?? []).map(
    (row) => row.production_item_id as string
  );

  if (!productionItemIds.length) {
    throw new ProofError("This proof has no linked manifest items.", 400);
  }

  return productionItemIds;
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

async function loadProofSourceArtwork(
  adminClient: SupabaseClient,
  jobId: string,
  proofId: string
) {
  await loadMutableProofRecord(adminClient, jobId, proofId);

  const { data: proofFile, error } = await adminClient
    .from("job_proof_files")
    .select("job_file_id, dropbox_path, file_name, mime_type")
    .eq("proof_id", proofId)
    .eq("file_role", "source_artwork")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new ProofError(error.message, 500);
  }

  if (!proofFile?.dropbox_path) {
    throw new ProofError("Attach proof artwork before generating a branded PDF.", 409);
  }

  const fileName = proofFile.file_name as string;
  assertSupportedExtension(fileName);

  const downloaded = await downloadDropboxFile(proofFile.dropbox_path as string);
  assertAnalysisSize(downloaded.buffer);

  return {
    buffer: downloaded.buffer,
    fileName,
    mimeType: (proofFile.mime_type as string | null) ?? downloaded.contentType,
    dropboxPath: proofFile.dropbox_path as string,
    jobFileId: (proofFile.job_file_id as string | null) ?? null,
  };
}

export async function analyseExistingProofArtwork(
  adminClient: SupabaseClient,
  jobId: string,
  proofId: string
): Promise<PreflightResult> {
  const productionItemIds = await loadProofProductionItemIds(adminClient, proofId);
  const [quotedItems, artwork] = await Promise.all([
    loadQuotedSpecificationItems(adminClient, jobId, productionItemIds),
    loadProofSourceArtwork(adminClient, jobId, proofId),
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
    sourceJobFileId,
    reviewedByProfileId,
    generatedAt,
    generatedDropboxPath,
    generatedFileName,
    requirePersisted = false,
  }: {
    proofId: string;
    preflight: PreflightResult;
    manualOverrides?: PreflightManualOverrides;
    sourceDropboxPath?: string | null;
    sourceJobFileId?: string | null;
    reviewedByProfileId?: string | null;
    generatedAt?: string | null;
    generatedDropboxPath?: string | null;
    generatedFileName?: string | null;
    requirePersisted?: boolean;
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
    generated_at: generatedAt ?? null,
    generated_dropbox_path: generatedDropboxPath ?? null,
    generated_file_name: generatedFileName ?? null,
    metadata: {
      sizeComparison: preflight.sizeComparison,
      quotedItems: preflight.quotedItems,
      sourceReference: preflight.sourceReference,
      sourceJobFileId: sourceJobFileId ?? null,
    },
    updated_at: new Date().toISOString(),
  };

  const { error } = await adminClient.from("job_proof_preflight").upsert(payload, {
    onConflict: "proof_id",
  });

  if (error) {
    if (error.code === "42703" || error.code === "42P01") {
      if (requirePersisted) {
        throw new ProofError(
          "Proof preflight schema is not deployed. Apply the proof generator migrations before generating branded PDFs.",
          503
        );
      }
      return { saved: false, schemaMissing: true as const };
    }

    throw new ProofError(error.message, 500);
  }

  return { saved: true, schemaMissing: false as const };
}

export async function generateBrandedPdfForExistingProof(
  adminClient: SupabaseClient,
  {
    jobId,
    proofId,
    actorProfileId,
    preflightResult,
    manualOverrides,
  }: {
    jobId: string;
    proofId: string;
    actorProfileId: string;
    preflightResult: PreflightResult;
    manualOverrides?: PreflightManualOverrides;
  }
) {
  const proof = await loadMutableProofRecord(adminClient, jobId, proofId);

  const { data: job, error: jobError } = await adminClient
    .from("jobs")
    .select("company_id, quote_id, opportunity_id, job_reference, project_name, dropbox_folder_path")
    .eq("id", jobId)
    .maybeSingle();

  if (jobError) {
    throw new ProofError(jobError.message, 500);
  }

  if (!job) {
    throw new ProofError("Job not found.", 404);
  }

  if (!job.dropbox_folder_path) {
    throw new ProofError("No Dropbox folder is linked to this job yet.", 409);
  }

  const artwork = await loadProofSourceArtwork(adminClient, jobId, proofId);
  const sourceDropboxPath = artwork.dropboxPath;
  const sourceJobFileId = artwork.jobFileId;

  let generatedPdf: Buffer;
  try {
    generatedPdf = await generateCustomerProofPdf({
      jobReference: job.job_reference as string,
      projectName: job.project_name as string,
      proofReference: proof.proof_reference as string,
      versionNumber: proof.version_number as number,
      customerMessage: (proof.customer_message as string | null) ?? null,
      preflight: preflightResult,
      sourceBuffer: artwork.buffer,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Branded proof PDF generation failed.";
    throw new ProofError(message, 500);
  }

  const pdfBuffer = Uint8Array.from(generatedPdf);

  if (!pdfBuffer.byteLength) {
    throw new ProofError("Branded proof PDF generation produced an empty file.", 500);
  }

  const uploadResult = await uploadProofFileToProofsFolder(adminClient, {
    jobId,
    proofId,
    fileName: `${proof.proof_reference as string}.pdf`,
    mimeType: "application/pdf",
    fileBuffer: pdfBuffer.buffer,
    actorProfileId,
  });

  const generatedAt = new Date().toISOString();

  await saveProofPreflightRecord(adminClient, {
    proofId,
    preflight: preflightResult,
    manualOverrides,
    sourceDropboxPath,
    sourceJobFileId,
    reviewedByProfileId: actorProfileId,
    generatedAt,
    generatedDropboxPath: uploadResult.dropboxPath,
    generatedFileName: uploadResult.fileName,
    requirePersisted: true,
  });

  await logProofActivity(adminClient, {
    activityType: PROOF_ACTIVITY_TYPES.proofBrandedPdfGenerated,
    description: `Generated branded customer PDF for ${proof.proof_reference as string}.`,
    companyId: job.company_id as string,
    quoteId: job.quote_id as string,
    opportunityId: job.opportunity_id as string | null,
    actorProfileId,
    metadata: {
      job_id: jobId,
      proof_id: proofId,
      overall_status: preflightResult.overallStatus,
      source_dropbox_path: sourceDropboxPath,
      generated_dropbox_path: uploadResult.dropboxPath,
      generated_file_name: uploadResult.fileName,
    },
  });

  revalidateJobPages({
    jobId,
    quoteId: job.quote_id as string,
    opportunityId: job.opportunity_id as string | null,
  });

  return {
    proofId,
    proofReference: proof.proof_reference as string,
    generatedFileName: uploadResult.fileName,
    generatedDropboxPath: uploadResult.dropboxPath,
    generatedAt,
  };
}
