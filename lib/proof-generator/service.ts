import type { SupabaseClient } from "@supabase/supabase-js";

import { downloadDropboxFile, getDropboxMetadata } from "@/lib/dropbox/client";
import { analyseImageBuffer } from "@/lib/proof-generator/analyse-image";
import { analysePdfBuffer } from "@/lib/proof-generator/analyse-pdf";
import {
  assertValidSourceArtworkBuffer,
  logProofGeneratorDebug,
} from "@/lib/proof-generator/artwork-buffer";
import {
  formatProofGeneratorMaxAnalysisLabel,
  getProofGeneratorMaxAnalysisBytes,
  PROOF_GENERATOR_OVERSIZE_MESSAGE,
  PROOF_GENERATOR_UNSUPPORTED_MESSAGE,
} from "@/lib/proof-generator/constants";
import { generateCustomerProofPdf } from "@/lib/proof-generator/generate-proof-pdf";
import { loadQuotedSpecificationItems } from "@/lib/proof-generator/quoted-specification";
import type {
  PreflightManualOverrides,
  PreflightResult,
} from "@/lib/proof-generator/types";
import { buildPreflightResult } from "@/lib/proof-generator/warnings";
import { PROOF_ACTIVITY_TYPES, PROOF_SELECT } from "@/lib/proofs/constants";
import { ProofError } from "@/lib/proofs/errors";
import { getFileExtension, normalizeDropboxApiPath } from "@/lib/proofs/file-validation";
import { logDropboxProofDebug, runDropboxProofOperation } from "@/lib/proofs/dropbox-errors";
import { logProofActivity } from "@/lib/proofs/activity";
import { revalidateJobPages } from "@/lib/jobs/revalidation";
import {
  isPathInProofsFolder,
  resolveProofsFolderPathForJob,
} from "@/lib/proofs/dropbox";
import { buildCustomerProofPdfFileName } from "@/lib/proofs/dropbox";
import {
  proofHasGeneratedCustomerArtifact,
  uploadProofFileToProofsFolder,
} from "@/lib/proofs/service";

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

async function loadProofSourceArtwork(
  adminClient: SupabaseClient,
  jobId: string,
  proofId: string
) {
  const proof = await loadMutableProofRecord(adminClient, jobId, proofId);

  const { data: job, error: jobError } = await adminClient
    .from("jobs")
    .select("job_reference, project_name, dropbox_folder_path")
    .eq("id", jobId)
    .maybeSingle();

  if (jobError) {
    throw new ProofError(jobError.message, 500);
  }

  if (!job) {
    throw new ProofError("Job not found.", 404);
  }

  const { data: proofFile, error } = await adminClient
    .from("job_proof_files")
    .select("job_file_id, dropbox_path, file_name, mime_type, file_role")
    .eq("proof_id", proofId)
    .eq("file_role", "source_artwork")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new ProofError(error.message, 500);
  }

  if (!proofFile?.dropbox_path?.trim()) {
    throw new ProofError(
      "No source artwork is attached to this proof version.",
      409
    );
  }

  const dropboxPath = normalizeDropboxApiPath(proofFile.dropbox_path as string);
  let fileName = proofFile.file_name as string;
  let mimeType = (proofFile.mime_type as string | null) ?? null;
  const jobFileId = (proofFile.job_file_id as string | null) ?? null;

  if (jobFileId) {
    const { data: jobFile, error: jobFileError } = await adminClient
      .from("job_files")
      .select("dropbox_path_lower, file_name, mime_type")
      .eq("id", jobFileId)
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .maybeSingle();

    if (jobFileError) {
      throw new ProofError(jobFileError.message, 500);
    }

    if (jobFile) {
      fileName = (jobFile.file_name as string) || fileName;
      mimeType = (jobFile.mime_type as string | null) ?? mimeType;

      const jobFilePath = jobFile.dropbox_path_lower
        ? normalizeDropboxApiPath(jobFile.dropbox_path_lower as string)
        : null;

      if (jobFilePath && jobFilePath !== dropboxPath) {
        logDropboxProofDebug("source_artwork_path_mismatch", {
          jobId,
          proofId,
          proofVersion: proof.version_number,
          proofLineageId: proof.proof_lineage_id,
          proofFilePath: dropboxPath,
          jobFilePath,
          jobFileId,
        });
      }
    } else {
      logDropboxProofDebug("source_artwork_stale_job_file_id", {
        jobId,
        proofId,
        proofVersion: proof.version_number,
        proofLineageId: proof.proof_lineage_id,
        jobFileId,
        proofFilePath: dropboxPath,
      });
    }
  }

  const proofsFolderPath = job.dropbox_folder_path
    ? resolveProofsFolderPathForJob(job.dropbox_folder_path as string)
    : null;

  logDropboxProofDebug("source_artwork_resolve", {
    jobId,
    proofId,
    proofVersion: proof.version_number,
    proofLineageId: proof.proof_lineage_id,
    sourceFileName: fileName,
    sourceDropboxPath: dropboxPath,
    dropboxFolderPath: job.dropbox_folder_path
      ? normalizeDropboxApiPath(job.dropbox_folder_path as string)
      : null,
    proofsFolderPath,
    jobFileId,
  });

  if (
    job.dropbox_folder_path &&
    isPathInProofsFolder(
      dropboxPath,
      job.dropbox_folder_path as string,
      job.job_reference as string,
      job.project_name as string
    )
  ) {
    throw new ProofError(
      "Source artwork cannot be a generated proof PDF from 03 Proofs. Re-attach the original artwork file.",
      409
    );
  }

  assertSupportedExtension(fileName);

  await runDropboxProofOperation(
    {
      operation: "download_source_artwork",
      path: dropboxPath,
      fileName,
      dropboxApi: "/2/files/get_metadata",
    },
    async () => {
      const { metadata } = await getDropboxMetadata(dropboxPath);
      if (!metadata || !("rev" in metadata)) {
        throw new ProofError(
          "Source artwork could not be found in Dropbox.",
          404
        );
      }
      return metadata;
    }
  );

  logProofGeneratorDebug("source_artwork_download_start", {
    jobId,
    proofId,
    proofVersion: proof.version_number,
    proofLineageId: proof.proof_lineage_id,
    fileName,
    dropboxPath,
    mimeType,
    jobFileId,
    dropboxApi: "/2/files/download",
  });

  const downloaded = await runDropboxProofOperation(
    {
      operation: "download_source_artwork",
      path: dropboxPath,
      fileName,
      dropboxApi: "/2/files/download",
    },
    () => downloadDropboxFile(dropboxPath)
  );
  assertAnalysisSize(downloaded.buffer);
  const detectedKind = assertValidSourceArtworkBuffer(downloaded.buffer, fileName);

  logProofGeneratorDebug("source_artwork_download_complete", {
    jobId,
    proofId,
    proofVersion: proof.version_number,
    proofLineageId: proof.proof_lineage_id,
    fileName,
    dropboxPath,
    mimeType: mimeType ?? downloaded.contentType,
    detectedKind,
    byteLength: downloaded.buffer.length,
  });

  return {
    buffer: downloaded.buffer,
    fileName,
    mimeType: mimeType ?? downloaded.contentType,
    dropboxPath,
    jobFileId,
    detectedKind,
    proofVersion: proof.version_number as number,
    proofLineageId: proof.proof_lineage_id as string,
  };
}

async function buildPreflightForSourceArtwork(
  adminClient: SupabaseClient,
  jobId: string,
  proofId: string,
  artwork: Awaited<ReturnType<typeof loadProofSourceArtwork>>
) {
  const productionItemIds = await loadProofProductionItemIds(adminClient, proofId);
  const quotedItems = await loadQuotedSpecificationItems(
    adminClient,
    jobId,
    productionItemIds
  );

  logProofGeneratorDebug("quoted_specification_resolved", {
    proofId,
    productionItemIds,
    quotedItems: quotedItems.map((item) => ({
      id: item.id,
      itemReference: item.itemReference,
      quotedWidthMm: item.quotedWidthMm,
      quotedHeightMm: item.quotedHeightMm,
      material: item.material,
      printSpecification: item.printSpecification,
      sides: item.sides,
      finishing: item.finishing,
    })),
  });

  const metadata =
    artwork.detectedKind === "pdf"
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

export async function analyseExistingProofArtwork(
  adminClient: SupabaseClient,
  jobId: string,
  proofId: string
): Promise<PreflightResult> {
  const artwork = await loadProofSourceArtwork(adminClient, jobId, proofId);
  return buildPreflightForSourceArtwork(adminClient, jobId, proofId, artwork);
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
    manualOverrides,
  }: {
    jobId: string;
    proofId: string;
    actorProfileId: string;
    preflightResult?: PreflightResult;
    manualOverrides?: PreflightManualOverrides;
  }
) {
  const proof = await loadMutableProofRecord(adminClient, jobId, proofId);

  if (await proofHasGeneratedCustomerArtifact(adminClient, proofId)) {
    throw new ProofError(
      "This proof version already has a generated customer PDF. Use Create revised proof to start the next version, then attach artwork and generate again.",
      409
    );
  }

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
  const preflightResult = await buildPreflightForSourceArtwork(
    adminClient,
    jobId,
    proofId,
    artwork
  );

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
      sourceFileName: artwork.fileName,
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

  const productionItemIds = await loadProofProductionItemIds(adminClient, proofId);
  const { data: itemLinks } = await adminClient
    .from("job_proof_manifest_items")
    .select("production_item_id, production_items(item_reference)")
    .eq("proof_id", proofId);

  const itemReferences = (itemLinks ?? [])
    .map(
      (link) =>
        (link.production_items as { item_reference?: string | null } | null)
          ?.item_reference ?? null
    )
    .filter(Boolean) as string[];

  const itemReference = itemReferences.length === 1 ? itemReferences[0] : null;
  const generatedFileName = buildCustomerProofPdfFileName({
    versionNumber: proof.version_number as number,
    itemReference,
    jobReference: job.job_reference as string,
  });
  const proofsFolderPath = resolveProofsFolderPathForJob(
    job.dropbox_folder_path as string
  );

  logDropboxProofDebug("branded_pdf_generate_start", {
    jobId,
    proofId,
    proofVersion: proof.version_number,
    proofLineageId: proof.proof_lineage_id,
    sourceFileName: artwork.fileName,
    sourceDropboxPath: artwork.dropboxPath,
    dropboxFolderPath: normalizeDropboxApiPath(job.dropbox_folder_path as string),
    proofsFolderPath,
    generatedDestinationFileName: generatedFileName,
  });

  const uploadResult = await uploadProofFileToProofsFolder(adminClient, {
    jobId,
    proofId,
    fileName: generatedFileName,
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
      production_item_ids: productionItemIds,
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
