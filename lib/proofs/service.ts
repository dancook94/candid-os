import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { validateProofCreatableManifestItemSelection } from "@/lib/manifest/proof-requirement";
import { loadManifestItemsForProofContext } from "@/lib/manifest/proof-requirement-service";
import { revalidateJobPages } from "@/lib/jobs/revalidation";
import { resolveJobProofRequired } from "@/lib/notifications/artwork-copy";
import { ProofError, isMissingProofSchemaError } from "@/lib/proofs/errors";
import {
  PROOF_ACTIVITY_TYPES,
  PROOF_ATTACHABLE_STATUSES,
  PROOF_BYPASS_REASON_LABELS,
  PROOF_CONFIRMATION_TEXT,
  PROOF_FILE_SELECT,
  PROOF_SELECT,
  type ProofArtworkOrigin,
  type ProofBypassReason,
  type ProofFileRole,
  type ProofInternalChecklistKey,
} from "@/lib/proofs/constants";
import { logProofActivity } from "@/lib/proofs/activity";
import {
  copyProofFileToProofsFolder,
  assertDropboxPathInJobSubfolder,
  assertVersionedProofPathAvailable,
  buildProofUploadTargetFileName,
  ensureJobProofsFolder,
  isPathInProofsFolder,
  proofArtifactMatchesVersion,
  resolveDropboxFileMetadata,
  resolveProofsFolderPath,
  resolveProofsFolderPathForJob,
  resolveProofsFolderPathOrThrow,
} from "@/lib/proofs/dropbox";
import { resolveCustomerProofDownloadFile } from "@/lib/proofs/download-file";
import {
  buildProofReference,
  getInProgressProof,
  hasBlockingInProgressRevision,
  isRevisableProofStatus,
  manifestItemSetsMatch,
  proofSupportsRevision,
} from "@/lib/proofs/versioning";
import {
  assertProofUploadFile,
  getFileExtension,
  isCustomerFacingProofAsset,
  isCustomerFacingProofExtension,
  joinDropboxPathWithFile,
  normalizeDropboxApiPath,
  normalizeDropboxPath,
  resolveProofFileLocationType,
} from "@/lib/proofs/file-validation";
import {
  logDropboxProofDebug,
  runDropboxProofOperation,
} from "@/lib/proofs/dropbox-errors";
import { syncJobProofWorkflowStatus } from "@/lib/proofs/gates";
import { normalizeProofFileRole } from "@/lib/proofs/proof-files";
import {
  prepareProofApprovedNotification,
  prepareProofChangesRequestedNotification,
  prepareProofReadyNotification,
  prepareProofReadyResendNotification,
} from "@/lib/proofs/notifications";
import type {
  AttachProofFileInput,
  CreateProofInput,
  JobProofFileView,
  JobProofView,
} from "@/lib/proofs/types";
import { uploadSmallDropboxFile } from "@/lib/dropbox/upload-session";
import {
  CUSTOMER_UPLOAD_SUBFOLDER,
  PROOFS_SUBFOLDER,
  WORKING_FILES_SUBFOLDER,
} from "@/lib/dropbox/job-folders";

type JobContext = {
  id: string;
  company_id: string;
  quote_id: string;
  opportunity_id: string | null;
  job_reference: string;
  project_name: string;
  proof_required: boolean;
  dropbox_folder_path: string | null;
};

function mapProofFileView(
  file: Record<string, unknown>,
  dropboxFolderPath: string | null
): JobProofFileView {
  const dropboxPath = (file.dropbox_path as string | null) ?? null;
  const jobFileId = (file.job_file_id as string | null) ?? null;
  const fileName = file.file_name as string;

  return {
    ...(file as JobProofFileView),
    file_role: normalizeProofFileRole(file.file_role as string | null | undefined),
    location_type: resolveProofFileLocationType({
      dropboxPath,
      dropboxFolderPath,
      jobFileId,
    }),
    is_customer_facing: isCustomerFacingProofAsset({
      fileName,
      dropboxPath,
      dropboxFolderPath,
      jobFileId,
    }),
  };
}

async function loadJobContext(
  adminClient: SupabaseClient,
  jobId: string
): Promise<JobContext> {
  const { data, error } = await adminClient
    .from("jobs")
    .select(
      "id, company_id, quote_id, opportunity_id, job_reference, project_name, proof_required, dropbox_folder_path"
    )
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    if (isMissingProofSchemaError(error)) {
      throw new ProofError("Proofing schema is not deployed.", 503);
    }
    throw new ProofError(error.message, 500);
  }

  if (!data) {
    throw new ProofError("Job not found.", 404);
  }

  return data as JobContext;
}

export async function nextProofVersionInLineage(
  adminClient: SupabaseClient,
  proofLineageId: string
) {
  const { data, error } = await adminClient
    .from("job_proofs")
    .select("version_number")
    .eq("proof_lineage_id", proofLineageId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new ProofError(error.message, 500);
  }

  return (data?.version_number ?? 0) + 1;
}

async function loadProofManifestItemIds(
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

  return (data ?? []).map((link) => link.production_item_id as string);
}

async function loadJobProofLineageIndex(
  adminClient: SupabaseClient,
  jobId: string
) {
  const { data: proofs, error } = await adminClient
    .from("job_proofs")
    .select("id, proof_lineage_id, version_number")
    .eq("job_id", jobId);

  if (error) {
    throw new ProofError(error.message, 500);
  }

  const proofIds = (proofs ?? []).map((proof) => proof.id as string);
  if (!proofIds.length) {
    return [] as Array<{
      proof_lineage_id: string;
      version_number: number;
      productionItemIds: string[];
    }>;
  }

  const { data: links, error: linkError } = await adminClient
    .from("job_proof_manifest_items")
    .select("proof_id, production_item_id")
    .in("proof_id", proofIds);

  if (linkError) {
    throw new ProofError(linkError.message, 500);
  }

  const itemsByProofId = new Map<string, string[]>();
  for (const link of links ?? []) {
    const proofId = link.proof_id as string;
    const items = itemsByProofId.get(proofId) ?? [];
    items.push(link.production_item_id as string);
    itemsByProofId.set(proofId, items);
  }

  const lineageById = new Map<
    string,
    { proof_lineage_id: string; version_number: number; productionItemIds: string[] }
  >();

  for (const proof of proofs ?? []) {
    const proofLineageId = proof.proof_lineage_id as string;
    if (!lineageById.has(proofLineageId)) {
      lineageById.set(proofLineageId, {
        proof_lineage_id: proofLineageId,
        version_number: proof.version_number as number,
        productionItemIds: itemsByProofId.get(proof.id as string) ?? [],
      });
    } else {
      const existing = lineageById.get(proofLineageId)!;
      existing.version_number = Math.max(
        existing.version_number,
        proof.version_number as number
      );
    }
  }

  return [...lineageById.values()];
}

async function findLineageIdForManifestItems(
  adminClient: SupabaseClient,
  jobId: string,
  productionItemIds: string[]
) {
  const lineages = await loadJobProofLineageIndex(adminClient, jobId);
  const match = lineages.find((lineage) =>
    manifestItemSetsMatch(lineage.productionItemIds, productionItemIds)
  );

  return match?.proof_lineage_id ?? null;
}

async function assertNewLineageAvailableForManifestItems(
  adminClient: SupabaseClient,
  jobId: string,
  productionItemIds: string[]
) {
  const existingLineageId = await findLineageIdForManifestItems(
    adminClient,
    jobId,
    productionItemIds
  );

  if (existingLineageId) {
    throw new ProofError(
      "A proof already exists for these manifest items. Use Create revised proof to add the next version.",
      409
    );
  }
}

export async function proofHasGeneratedCustomerArtifact(
  adminClient: SupabaseClient,
  proofId: string
) {
  const customerProof = await loadProofFileRecord(adminClient, proofId, "customer_proof");
  if (customerProof?.dropbox_path) {
    return true;
  }

  const { data: preflight, error } = await adminClient
    .from("job_proof_preflight")
    .select("generated_at")
    .eq("proof_id", proofId)
    .maybeSingle();

  if (error) {
    if (error.code === "42703" || error.code === "42P01") {
      return false;
    }
    throw new ProofError(error.message, 500);
  }

  return Boolean(preflight?.generated_at);
}

async function loadManifestItemsByIds(
  adminClient: SupabaseClient,
  jobId: string,
  itemIds: string[]
) {
  const { data, error } = await adminClient
    .from("production_items")
    .select("id, item_reference, item_name, quantity, width_mm, height_mm")
    .eq("job_id", jobId)
    .in("id", itemIds)
    .is("deleted_at", null);

  if (error) {
    throw new ProofError(error.message, 500);
  }

  if ((data ?? []).length !== itemIds.length) {
    throw new ProofError("One or more manifest items were not found on this job.", 404);
  }

  return data ?? [];
}

async function resolveSourceFileMetadata(
  adminClient: SupabaseClient,
  job: JobContext,
  input: CreateProofInput
) {
  const hasSource =
    Boolean(input.sourceJobFileId) || Boolean(input.dropboxSourcePath?.trim());

  if (!hasSource) {
    return null;
  }

  if (input.sourceJobFileId) {
    const { data: jobFile, error } = await adminClient
      .from("job_files")
      .select("*")
      .eq("id", input.sourceJobFileId)
      .eq("job_id", job.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (error || !jobFile) {
      throw new ProofError("Source artwork file not found.", 404);
    }

    if (jobFile.upload_status !== "complete" || !jobFile.dropbox_path_lower) {
      throw new ProofError("Source artwork file is not ready.", 409);
    }

    return {
      jobFileId: jobFile.id as string,
      dropboxFileId: jobFile.dropbox_file_id as string | null,
      dropboxPath: jobFile.dropbox_path_lower as string,
      dropboxRevision: jobFile.dropbox_revision as string | null,
      fileName: jobFile.file_name as string,
      mimeType: jobFile.mime_type as string | null,
      fileSizeBytes: Number(jobFile.file_size_bytes ?? 0),
      contentHash: jobFile.content_hash as string | null,
    };
  }

  if (input.dropboxSourcePath?.trim()) {
    const metadata = await resolveDropboxFileMetadata(input.dropboxSourcePath.trim());
    return {
      jobFileId: null,
      dropboxFileId: metadata.id,
      dropboxPath: metadata.path_lower ?? metadata.path_display,
      dropboxRevision: metadata.rev,
      fileName: input.dropboxFileName?.trim() || metadata.name,
      mimeType: null,
      fileSizeBytes: metadata.size,
      contentHash: metadata.content_hash ?? null,
    };
  }

  throw new ProofError("A source artwork file is required.", 400);
}

export async function loadProofsForJob(
  adminClient: SupabaseClient,
  jobId: string,
  options: { customerSafe?: boolean } = {}
): Promise<{ schemaMissing: boolean; proofs: JobProofView[] }> {
  const [{ data: proofs, error }, { data: job }] = await Promise.all([
    adminClient
      .from("job_proofs")
      .select(PROOF_SELECT)
      .eq("job_id", jobId)
      .order("version_number", { ascending: false }),
    adminClient
      .from("jobs")
      .select("dropbox_folder_path, job_reference")
      .eq("id", jobId)
      .maybeSingle(),
  ]);

  if (error) {
    if (isMissingProofSchemaError(error)) {
      return { schemaMissing: true, proofs: [] };
    }
    throw new ProofError(error.message, 500);
  }

  const dropboxFolderPath = (job?.dropbox_folder_path as string | null) ?? null;
  const jobReference = (job?.job_reference as string | null) ?? null;

  const staleReferenceUpdates: Array<{ id: string; proof_reference: string }> = [];
  for (const proof of proofs ?? []) {
    if (!jobReference) {
      continue;
    }

    const expectedReference = buildProofReference(
      jobReference,
      proof.version_number as number
    );
    if (proof.proof_reference !== expectedReference) {
      staleReferenceUpdates.push({
        id: proof.id as string,
        proof_reference: expectedReference,
      });
      proof.proof_reference = expectedReference;
    }
  }

  if (staleReferenceUpdates.length) {
    await Promise.all(
      staleReferenceUpdates.map((update) =>
        adminClient
          .from("job_proofs")
          .update({ proof_reference: update.proof_reference })
          .eq("id", update.id)
      )
    );
  }

  const proofIds = (proofs ?? []).map((proof) => proof.id);
  if (proofIds.length === 0) {
    return { schemaMissing: false, proofs: [] };
  }

  const [{ data: files }, { data: itemLinks }, { data: manifestItems }] =
    await Promise.all([
      adminClient.from("job_proof_files").select(PROOF_FILE_SELECT).in("proof_id", proofIds),
      adminClient
        .from("job_proof_manifest_items")
        .select("proof_id, production_item_id")
        .in("proof_id", proofIds),
      adminClient
        .from("production_items")
        .select("id, item_reference, item_name, quantity, width_mm, height_mm")
        .eq("job_id", jobId)
        .is("deleted_at", null),
    ]);

  const preflightResult = await adminClient
    .from("job_proof_preflight")
    .select("proof_id, generated_at")
    .in("proof_id", proofIds);

  const preflightByProofId = new Map(
    preflightResult.error?.code === "42703"
      ? []
      : (preflightResult.data ?? []).map((row) => [
          row.proof_id as string,
          (row.generated_at as string | null) ?? null,
        ])
  );

  const manifestById = new Map((manifestItems ?? []).map((item) => [item.id, item]));

  return {
    schemaMissing: false,
    proofs: (proofs ?? []).map((proof) => {
      const linkedItemIds = (itemLinks ?? [])
        .filter((link) => link.proof_id === proof.id)
        .map((link) => link.production_item_id);

      const mapped: JobProofView = {
        ...(proof as JobProofView),
        brandedPdfGeneratedAt: preflightByProofId.get(proof.id as string) ?? null,
        files: (files ?? [])
          .filter((file) => file.proof_id === proof.id)
          .map((file) => mapProofFileView(file, dropboxFolderPath)),
        manifestItems: linkedItemIds
          .map((id) => manifestById.get(id))
          .filter(Boolean) as JobProofView["manifestItems"],
      };

      if (options.customerSafe) {
        mapped.internal_note = null;
        mapped.files = mapped.files.map((file) => ({
          id: file.id,
          proof_id: file.proof_id,
          file_role: file.file_role,
          job_file_id: null,
          dropbox_file_id: null,
          dropbox_path: null,
          dropbox_revision: null,
          file_name: file.file_name,
          mime_type: file.mime_type,
          file_size_bytes: file.file_size_bytes,
          content_hash: null,
          preview_dropbox_path: null,
          preview_metadata: null,
          created_at: file.created_at,
          location_type: null,
          is_customer_facing: file.is_customer_facing,
        }));
      }

      return mapped;
    }),
  };
}

export async function loadJobProofRequirement(
  adminClient: SupabaseClient,
  jobId: string
) {
  const { data, error } = await adminClient
    .from("jobs")
    .select(
      "proof_required, proof_workflow_status, proof_bypass_reason, proof_bypassed_at, proof_bypassed_by_profile_id, proof_approved_at"
    )
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    if (isMissingProofSchemaError(error)) {
      return { schemaMissing: true, proofRequired: true, workflowStatus: "no_proof" as const };
    }
    throw new ProofError(error.message, 500);
  }

  return {
    schemaMissing: false,
    proofRequired: resolveJobProofRequired({ proof_required: data?.proof_required }),
    workflowStatus: (data?.proof_workflow_status ?? "no_proof") as string,
    bypassReason: data?.proof_bypass_reason ?? null,
    bypassedAt: data?.proof_bypassed_at ?? null,
    bypassedByProfileId: data?.proof_bypassed_by_profile_id ?? null,
    proofApprovedAt: data?.proof_approved_at ?? null,
  };
}

export async function updateJobProofRequirement(
  adminClient: SupabaseClient,
  {
    jobId,
    proofRequired,
    bypassReason,
    actorProfileId,
  }: {
    jobId: string;
    proofRequired: boolean;
    bypassReason?: ProofBypassReason | null;
    otherReason?: string | null;
    actorProfileId: string;
  }
) {
  const job = await loadJobContext(adminClient, jobId);
  const now = new Date().toISOString();

  if (!proofRequired) {
    if (!bypassReason) {
      throw new ProofError("A bypass reason is required when proof is not required.", 400);
    }

    const reasonText =
      bypassReason === "other"
        ? "Other"
        : PROOF_BYPASS_REASON_LABELS[bypassReason];

    await adminClient
      .from("jobs")
      .update({
        proof_required: false,
        proof_workflow_status: "not_required",
        proof_bypass_reason: reasonText,
        proof_bypassed_by_profile_id: actorProfileId,
        proof_bypassed_at: now,
        proof_approved_at: null,
        proof_approved_by_profile_id: null,
        updated_at: now,
      })
      .eq("id", jobId);

    await logProofActivity(adminClient, {
      activityType: PROOF_ACTIVITY_TYPES.proofBypassed,
      description: `Proof requirement bypassed for ${job.job_reference}.`,
      companyId: job.company_id,
      quoteId: job.quote_id,
      opportunityId: job.opportunity_id,
      actorProfileId,
      metadata: { job_id: jobId, bypass_reason: reasonText },
    });
  } else {
    await adminClient
      .from("jobs")
      .update({
        proof_required: true,
        proof_workflow_status: "no_proof",
        proof_bypass_reason: null,
        proof_bypassed_by_profile_id: null,
        proof_bypassed_at: null,
        updated_at: now,
      })
      .eq("id", jobId);

    await syncJobProofWorkflowStatus(adminClient, jobId);

    await logProofActivity(adminClient, {
      activityType: PROOF_ACTIVITY_TYPES.proofRequirementChanged,
      description: `Proof requirement enabled for ${job.job_reference}.`,
      companyId: job.company_id,
      quoteId: job.quote_id,
      opportunityId: job.opportunity_id,
      actorProfileId,
      metadata: { job_id: jobId, proof_required: true },
    });
  }

  revalidateJobPages({
    jobId,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
  });

  return { ok: true };
}

export async function createJobProof(
  adminClient: SupabaseClient,
  {
    jobId,
    input,
    actorProfileId,
  }: {
    jobId: string;
    input: CreateProofInput;
    actorProfileId: string;
  }
) {
  const job = await loadJobContext(adminClient, jobId);

  if (!job.proof_required) {
    throw new ProofError("Proof is not required for this job.", 409);
  }

  if (!input.title.trim()) {
    throw new ProofError("Proof title is required.", 400);
  }

  if (!input.productionItemIds.length) {
    throw new ProofError("Select at least one manifest item.", 400);
  }

  const manifestContext = await loadManifestItemsForProofContext(adminClient, jobId);
  const selectionValidation = validateProofCreatableManifestItemSelection(
    manifestContext.items,
    input.productionItemIds
  );

  if (!selectionValidation.ok) {
    throw new ProofError(selectionValidation.message, 400);
  }

  const manifestItems = await loadManifestItemsByIds(
    adminClient,
    jobId,
    input.productionItemIds
  );
  await assertNewLineageAvailableForManifestItems(
    adminClient,
    jobId,
    input.productionItemIds
  );
  const sourceFile = await resolveSourceFileMetadata(adminClient, job, input);
  const proofLineageId = randomUUID();
  const versionNumber = 1;
  const proofReference = buildProofReference(job.job_reference, versionNumber);
  const now = new Date().toISOString();

  const { data: proof, error } = await adminClient
    .from("job_proofs")
    .insert({
      job_id: jobId,
      company_id: job.company_id,
      proof_lineage_id: proofLineageId,
      proof_reference: proofReference,
      version_number: versionNumber,
      status: "draft",
      title: input.title.trim(),
      artwork_origin: input.artworkOrigin,
      customer_message: input.customerMessage?.trim() || null,
      internal_note: input.internalNote?.trim() || null,
      created_by_profile_id: actorProfileId,
      updated_at: now,
    })
    .select(PROOF_SELECT)
    .single();

  if (error || !proof) {
    throw new ProofError(error?.message ?? "Unable to create proof.", 500);
  }

  if (sourceFile) {
    const { error: fileError } = await adminClient.from("job_proof_files").insert({
      proof_id: proof.id,
      file_role: "source_artwork",
      job_file_id: sourceFile.jobFileId,
      dropbox_file_id: sourceFile.dropboxFileId,
      dropbox_path: sourceFile.dropboxPath,
      dropbox_revision: sourceFile.dropboxRevision,
      file_name: sourceFile.fileName,
      mime_type: sourceFile.mimeType,
      file_size_bytes: sourceFile.fileSizeBytes,
      content_hash: sourceFile.contentHash,
    });

    if (fileError) {
      throw new ProofError(fileError.message, 500);
    }
  }

  const { error: linkError } = await adminClient.from("job_proof_manifest_items").insert(
    manifestItems.map((item) => ({
      proof_id: proof.id,
      production_item_id: item.id,
    }))
  );

  if (linkError) {
    throw new ProofError(linkError.message, 500);
  }

  await syncJobProofWorkflowStatus(adminClient, jobId);

  await logProofActivity(adminClient, {
    activityType: PROOF_ACTIVITY_TYPES.proofCreated,
    description: `${proofReference} created for ${job.job_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
    actorProfileId,
    metadata: {
      job_id: jobId,
      proof_id: proof.id,
      version_number: versionNumber,
      proof_lineage_id: proofLineageId,
      production_item_ids: input.productionItemIds,
    },
  });

  revalidateJobPages({
    jobId,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
  });

  return proof;
}

export async function createRevisedJobProof(
  adminClient: SupabaseClient,
  {
    jobId,
    sourceProofId,
    actorProfileId,
    customerMessage,
    internalNote,
  }: {
    jobId: string;
    sourceProofId: string;
    actorProfileId: string;
    customerMessage?: string | null;
    internalNote?: string | null;
  }
) {
  const job = await loadJobContext(adminClient, jobId);

  if (!job.proof_required) {
    throw new ProofError("Proof is not required for this job.", 409);
  }

  const { data: sourceProof, error: sourceError } = await adminClient
    .from("job_proofs")
    .select(PROOF_SELECT)
    .eq("id", sourceProofId)
    .eq("job_id", jobId)
    .maybeSingle();

  if (sourceError) {
    throw new ProofError(sourceError.message, 500);
  }

  if (!sourceProof) {
    throw new ProofError("Source proof not found.", 404);
  }

  const { data: preflight, error: preflightError } = await adminClient
    .from("job_proof_preflight")
    .select("generated_at")
    .eq("proof_id", sourceProofId)
    .maybeSingle();

  if (preflightError && preflightError.code !== "42703" && preflightError.code !== "42P01") {
    throw new ProofError(preflightError.message, 500);
  }

  const sourceSupportsRevision = proofSupportsRevision({
    status: sourceProof.status as string,
    brandedPdfGeneratedAt: (preflight?.generated_at as string | null) ?? null,
    hasGeneratedCustomerProof: await proofHasGeneratedCustomerArtifact(
      adminClient,
      sourceProofId
    ),
  });

  if (!sourceSupportsRevision) {
    throw new ProofError(
      "This proof version cannot be revised yet. Revise from a sent, approved, changes-requested, or already-generated proof version.",
      409
    );
  }

  const proofLineageId = sourceProof.proof_lineage_id as string;

  const { data: existingProofs, error: existingError } = await adminClient
    .from("job_proofs")
    .select("id, status, version_number, proof_lineage_id")
    .eq("job_id", jobId);

  if (existingError) {
    throw new ProofError(existingError.message, 500);
  }

  const lineageProofs = (existingProofs ?? []).filter(
    (proof) => proof.proof_lineage_id === proofLineageId
  );
  if (
    hasBlockingInProgressRevision(lineageProofs, {
      id: sourceProofId,
      version_number: sourceProof.version_number as number,
    })
  ) {
    const inProgress = getInProgressProof(lineageProofs);
    throw new ProofError(
      `Proof v${inProgress?.version_number ?? "?"} is already in progress for this proof series. Finish that version before creating a revision.`,
      409
    );
  }

  const productionItemIds = await loadProofManifestItemIds(adminClient, sourceProofId);

  if (!productionItemIds.length) {
    throw new ProofError("The source proof has no linked manifest items.", 409);
  }

  await loadManifestItemsByIds(adminClient, jobId, productionItemIds);

  const versionNumber = await nextProofVersionInLineage(adminClient, proofLineageId);
  const proofReference = buildProofReference(job.job_reference, versionNumber);
  const now = new Date().toISOString();

  const { data: proof, error } = await adminClient
    .from("job_proofs")
    .insert({
      job_id: jobId,
      company_id: job.company_id,
      proof_lineage_id: proofLineageId,
      proof_reference: proofReference,
      version_number: versionNumber,
      status: "draft",
      title: sourceProof.title,
      artwork_origin: sourceProof.artwork_origin,
      customer_message:
        customerMessage !== undefined
          ? customerMessage?.trim() || null
          : (sourceProof.customer_message as string | null),
      internal_note: internalNote?.trim() || null,
      created_by_profile_id: actorProfileId,
      updated_at: now,
    })
    .select(PROOF_SELECT)
    .single();

  if (error || !proof) {
    throw new ProofError(error?.message ?? "Unable to create revised proof.", 500);
  }

  const { error: linkError } = await adminClient.from("job_proof_manifest_items").insert(
    productionItemIds.map((productionItemId) => ({
      proof_id: proof.id,
      production_item_id: productionItemId,
    }))
  );

  if (linkError) {
    throw new ProofError(linkError.message, 500);
  }

  await syncJobProofWorkflowStatus(adminClient, jobId);

  await logProofActivity(adminClient, {
    activityType: PROOF_ACTIVITY_TYPES.proofCreated,
    description: `${proofReference} created as a revision of ${sourceProof.proof_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
    actorProfileId,
    metadata: {
      job_id: jobId,
      proof_id: proof.id,
      proof_lineage_id: proofLineageId,
      version_number: versionNumber,
      revised_from_proof_id: sourceProofId,
      revised_from_version_number: sourceProof.version_number,
      production_item_ids: productionItemIds,
    },
  });

  revalidateJobPages({
    jobId,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
  });

  return proof;
}

export async function submitProofInternalReview(
  adminClient: SupabaseClient,
  {
    jobId,
    proofId,
    checklist,
    actorProfileId,
  }: {
    jobId: string;
    proofId: string;
    checklist: Partial<Record<ProofInternalChecklistKey, boolean>>;
    actorProfileId: string;
  }
) {
  const proof = await loadMutableProof(adminClient, jobId, proofId);

  if (proof.status !== "draft") {
    throw new ProofError("Only draft proofs can enter internal review.", 409);
  }

  const now = new Date().toISOString();

  await adminClient.from("job_proof_internal_reviews").insert({
    proof_id: proofId,
    checklist,
    reviewed_by_profile_id: actorProfileId,
    reviewed_at: now,
  });

  await adminClient
    .from("job_proofs")
    .update({
      status: "internal_review",
      internal_review_at: now,
      internal_review_by_profile_id: actorProfileId,
      updated_at: now,
    })
    .eq("id", proofId);

  await syncJobProofWorkflowStatus(adminClient, jobId);

  return { ok: true };
}

async function loadProofFileRecord(
  adminClient: SupabaseClient,
  proofId: string,
  fileRole?: ProofFileRole
) {
  let query = adminClient
    .from("job_proof_files")
    .select(PROOF_FILE_SELECT)
    .eq("proof_id", proofId);

  if (fileRole) {
    query = query.eq("file_role", fileRole);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new ProofError(error.message, 500);
  }

  return data;
}

function assertProofStatusAllowsAttachment(status: string) {
  if (
    !PROOF_ATTACHABLE_STATUSES.includes(
      status as (typeof PROOF_ATTACHABLE_STATUSES)[number]
    )
  ) {
    throw new ProofError("Proof file can no longer be changed.", 409);
  }
}

function assertPathInJobProofsFolder(
  dropboxPath: string,
  dropboxFolderPath: string | null
) {
  const proofsFolderPath = resolveProofsFolderPathForJob(dropboxFolderPath);
  if (!proofsFolderPath) {
    throw new ProofError("Proofs folder path is unavailable.", 500);
  }

  const normalizedPath = normalizeDropboxPath(dropboxPath);
  const normalizedFolder = normalizeDropboxPath(proofsFolderPath);

  if (
    normalizedPath !== normalizedFolder &&
    !normalizedPath.startsWith(`${normalizedFolder}/`)
  ) {
    throw new ProofError(
      "The customer-facing proof PDF must be stored in the job 03 Proofs folder.",
      409
    );
  }
}

async function assertCustomerFacingProofAttached(
  adminClient: SupabaseClient,
  proofId: string,
  dropboxFolderPath: string | null,
  message: string
) {
  const sourceArtwork = await loadProofFileRecord(adminClient, proofId, "source_artwork");
  const customerProof = await loadProofFileRecord(adminClient, proofId, "customer_proof");

  if (sourceArtwork) {
    if (!customerProof?.dropbox_path) {
      throw new ProofError(
        "Generate the branded customer proof PDF before sending this proof to the customer.",
        409
      );
    }

    if (
      customerProof.mime_type !== "application/pdf" &&
      getFileExtension(customerProof.file_name) !== "pdf"
    ) {
      throw new ProofError(
        "The customer-facing proof must be a generated PDF before sending.",
        409
      );
    }

    assertPathInJobProofsFolder(customerProof.dropbox_path, dropboxFolderPath);
    return customerProof;
  }

  const proofFile = customerProof ?? (await loadProofFileRecord(adminClient, proofId));

  if (!proofFile?.dropbox_path) {
    throw new ProofError(message, 409);
  }

  if (
    !isCustomerFacingProofAsset({
      fileName: proofFile.file_name,
      dropboxPath: proofFile.dropbox_path,
      dropboxFolderPath,
      jobFileId: proofFile.job_file_id,
    })
  ) {
    throw new ProofError(message, 409);
  }

  return proofFile;
}

async function resolveAttachProofFileMetadata(
  adminClient: SupabaseClient,
  job: JobContext,
  input: AttachProofFileInput
) {
  if (!job.dropbox_folder_path) {
    throw new ProofError("No Dropbox folder is linked to this job yet.", 409);
  }

  if (input.source === "customer_artwork") {
    if (!input.sourceJobFileId) {
      throw new ProofError("Select a customer artwork file.", 400);
    }

    const { data: jobFile, error } = await adminClient
      .from("job_files")
      .select("*")
      .eq("id", input.sourceJobFileId)
      .eq("job_id", job.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (error || !jobFile) {
      throw new ProofError("Source artwork file not found.", 404);
    }

    if (jobFile.upload_status !== "complete" || !jobFile.dropbox_path_lower) {
      throw new ProofError("Source artwork file is not ready.", 409);
    }

    assertDropboxPathInJobSubfolder(
      jobFile.dropbox_path_lower as string,
      job.dropbox_folder_path,
      CUSTOMER_UPLOAD_SUBFOLDER
    );

    return {
      jobFileId: jobFile.id as string,
      dropboxFileId: jobFile.dropbox_file_id as string | null,
      dropboxPath: normalizeDropboxApiPath(jobFile.dropbox_path_lower as string),
      dropboxRevision: jobFile.dropbox_revision as string | null,
      fileName: jobFile.file_name as string,
      mimeType: jobFile.mime_type as string | null,
      fileSizeBytes: Number(jobFile.file_size_bytes ?? 0),
      contentHash: jobFile.content_hash as string | null,
    };
  }

  const dropboxSourcePath = input.dropboxSourcePath?.trim();
  if (!dropboxSourcePath) {
    throw new ProofError("Select a Dropbox file.", 400);
  }

  const subfolder =
    input.source === "working_file"
      ? WORKING_FILES_SUBFOLDER
      : PROOFS_SUBFOLDER;

  assertDropboxPathInJobSubfolder(
    dropboxSourcePath,
    job.dropbox_folder_path,
    subfolder
  );

  const metadata = await resolveDropboxFileMetadata(dropboxSourcePath);

  return {
    jobFileId: null,
    dropboxFileId: metadata.id,
    dropboxPath: normalizeDropboxApiPath(metadata.path_lower ?? metadata.path_display),
    dropboxRevision: metadata.rev,
    fileName: metadata.name,
    mimeType: null,
    fileSizeBytes: metadata.size,
    contentHash: metadata.content_hash ?? null,
  };
}

async function upsertProofFileRecord(
  adminClient: SupabaseClient,
  proofId: string,
  fileRole: ProofFileRole,
  metadata: {
    jobFileId: string | null;
    dropboxFileId: string | null;
    dropboxPath: string;
    dropboxRevision: string | null;
    fileName: string;
    mimeType: string | null;
    fileSizeBytes: number;
    contentHash: string | null;
  }
) {
  const existing = await loadProofFileRecord(adminClient, proofId, fileRole);
  const payload = {
    file_role: fileRole,
    job_file_id: metadata.jobFileId,
    dropbox_file_id: metadata.dropboxFileId,
    dropbox_path: metadata.dropboxPath,
    dropbox_revision: metadata.dropboxRevision,
    file_name: metadata.fileName,
    mime_type: metadata.mimeType,
    file_size_bytes: metadata.fileSizeBytes,
    content_hash: metadata.contentHash,
  };

  if (existing?.id) {
    const { error } = await adminClient
      .from("job_proof_files")
      .update(payload)
      .eq("id", existing.id);

    if (error) {
      throw new ProofError(error.message, 500);
    }

    return existing.id as string;
  }

  const { data, error } = await adminClient
    .from("job_proof_files")
    .insert({
      proof_id: proofId,
      ...payload,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new ProofError(error?.message ?? "Unable to attach proof file.", 500);
  }

  return data.id as string;
}

export async function attachProofFile(
  adminClient: SupabaseClient,
  {
    jobId,
    proofId,
    input,
    actorProfileId,
  }: {
    jobId: string;
    proofId: string;
    input: AttachProofFileInput;
    actorProfileId: string;
  }
) {
  const job = await loadJobContext(adminClient, jobId);
  const proof = await loadMutableProof(adminClient, jobId, proofId);

  assertProofStatusAllowsAttachment(proof.status);

  if (await proofHasGeneratedCustomerArtifact(adminClient, proofId)) {
    throw new ProofError(
      "This proof version already has a generated customer PDF. Use Create revised proof to start the next version before changing artwork.",
      409
    );
  }

  const metadata = await resolveAttachProofFileMetadata(adminClient, job, input);

  await upsertProofFileRecord(adminClient, proofId, "source_artwork", metadata);

  await adminClient
    .from("job_proofs")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", proofId);

  await logProofActivity(adminClient, {
    activityType: PROOF_ACTIVITY_TYPES.proofCreated,
    description: `Proof file attached to ${proof.proof_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
    actorProfileId,
    metadata: {
      job_id: jobId,
      proof_id: proofId,
      file_name: metadata.fileName,
      source: input.source,
    },
  });

  revalidateJobPages({
    jobId,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
  });

  return { ok: true };
}

export async function removeProofFile(
  adminClient: SupabaseClient,
  {
    jobId,
    proofId,
    actorProfileId,
  }: {
    jobId: string;
    proofId: string;
    actorProfileId: string;
  }
) {
  const job = await loadJobContext(adminClient, jobId);
  const proof = await loadMutableProof(adminClient, jobId, proofId);

  assertProofStatusAllowsAttachment(proof.status);

  if (await proofHasGeneratedCustomerArtifact(adminClient, proofId)) {
    throw new ProofError(
      "This proof version already has a generated customer PDF. Use Create revised proof to start the next version before changing artwork.",
      409
    );
  }

  const existing = await loadProofFileRecord(adminClient, proofId, "source_artwork");
  if (!existing?.id) {
    return { ok: true };
  }

  const { error } = await adminClient
    .from("job_proof_files")
    .delete()
    .eq("id", existing.id);

  if (error) {
    throw new ProofError(error.message, 500);
  }

  await adminClient
    .from("job_proofs")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", proofId);

  await logProofActivity(adminClient, {
    activityType: PROOF_ACTIVITY_TYPES.proofCreated,
    description: `Proof file removed from ${proof.proof_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
    actorProfileId,
    metadata: { job_id: jobId, proof_id: proofId },
  });

  revalidateJobPages({
    jobId,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
  });

  return { ok: true };
}

export async function uploadProofFileToProofsFolder(
  adminClient: SupabaseClient,
  {
    jobId,
    proofId,
    fileName,
    mimeType,
    fileBuffer,
    actorProfileId,
  }: {
    jobId: string;
    proofId: string;
    fileName: string;
    mimeType: string | null;
    fileBuffer: ArrayBuffer;
    actorProfileId: string;
  }
) {
  const job = await loadJobContext(adminClient, jobId);
  const proof = await loadMutableProof(adminClient, jobId, proofId);

  assertProofStatusAllowsAttachment(proof.status);

  if (!job.dropbox_folder_path) {
    throw new ProofError("No Dropbox folder is linked to this job yet.", 409);
  }

  const validationError = assertProofUploadFile({
    fileName,
    mimeType,
    fileSizeBytes: fileBuffer.byteLength,
  });

  if (validationError) {
    throw new ProofError(validationError, 400);
  }

  const proofsFolderPath = await ensureJobProofsFolder(
    normalizeDropboxApiPath(job.dropbox_folder_path)
  );

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
  const extension = getFileExtension(fileName);
  const targetFileName = buildProofUploadTargetFileName({
    itemReference,
    jobReference: job.job_reference,
    versionNumber: proof.version_number,
    extension,
  });
  const dropboxPath = joinDropboxPathWithFile(proofsFolderPath, targetFileName);

  logDropboxProofDebug("upload_generated_proof_start", {
    jobId,
    proofId,
    proofVersion: proof.version_number,
    dropboxFolderPath: normalizeDropboxApiPath(job.dropbox_folder_path),
    proofsFolderPath,
    generatedDestinationFileName: targetFileName,
    dropboxPath,
    dropboxApi: "/2/files/upload",
  });

  await assertVersionedProofPathAvailable(dropboxPath, {
    versionNumber: proof.version_number,
    targetFileName,
  });

  const uploaded = await runDropboxProofOperation(
    {
      operation: "upload_generated_proof",
      path: dropboxPath,
      fileName: targetFileName,
      dropboxApi: "/2/files/upload",
    },
    () =>
      uploadSmallDropboxFile({
        dropboxPath,
        body: fileBuffer,
      })
  );

  const uploadedPath = uploaded.path_lower ?? uploaded.path_display;
  const verified = await resolveDropboxFileMetadata(uploadedPath);

  if (!verified?.size) {
    throw new ProofError("Dropbox upload verification failed.", 500);
  }

  await upsertProofFileRecord(adminClient, proofId, "customer_proof", {
    jobFileId: null,
    dropboxFileId: verified.id,
    dropboxPath: verified.path_lower ?? verified.path_display,
    dropboxRevision: verified.rev,
    fileName: verified.name,
    mimeType,
    fileSizeBytes: verified.size,
    contentHash: verified.content_hash ?? null,
  });

  await adminClient
    .from("job_proofs")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", proofId);

  await logProofActivity(adminClient, {
    activityType: PROOF_ACTIVITY_TYPES.proofCreated,
    description: `Proof file uploaded to ${proof.proof_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
    actorProfileId,
    metadata: {
      job_id: jobId,
      proof_id: proofId,
      file_name: uploaded.name,
      source: "proofs_folder_upload",
    },
  });

  revalidateJobPages({
    jobId,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
  });

  return { ok: true, fileName: verified.name, dropboxPath: verified.path_lower ?? verified.path_display };
}

export async function uploadSourceArtworkForProof(
  adminClient: SupabaseClient,
  {
    jobId,
    proofId,
    fileName,
    mimeType,
    fileBuffer,
    actorProfileId,
  }: {
    jobId: string;
    proofId: string;
    fileName: string;
    mimeType: string | null;
    fileBuffer: ArrayBuffer;
    actorProfileId: string;
  }
) {
  const job = await loadJobContext(adminClient, jobId);
  const proof = await loadMutableProof(adminClient, jobId, proofId);

  assertProofStatusAllowsAttachment(proof.status);

  if (!job.dropbox_folder_path) {
    throw new ProofError("No Dropbox folder is linked to this job yet.", 409);
  }

  const validationError = assertProofUploadFile({
    fileName,
    mimeType,
    fileSizeBytes: fileBuffer.byteLength,
  });

  if (validationError) {
    throw new ProofError(validationError, 400);
  }

  const workingFolderPath = `${job.dropbox_folder_path.replace(/\/+$/, "")}/${WORKING_FILES_SUBFOLDER}`;
  const dropboxPath = `${workingFolderPath}/${fileName}`;

  const uploaded = await uploadSmallDropboxFile({
    dropboxPath,
    body: fileBuffer,
  });

  const uploadedPath = uploaded.path_lower ?? uploaded.path_display;
  const verified = await resolveDropboxFileMetadata(uploadedPath);

  if (!verified?.size) {
    throw new ProofError("Dropbox upload verification failed.", 500);
  }

  await upsertProofFileRecord(adminClient, proofId, "source_artwork", {
    jobFileId: null,
    dropboxFileId: verified.id,
    dropboxPath: verified.path_lower ?? verified.path_display,
    dropboxRevision: verified.rev,
    fileName: verified.name,
    mimeType,
    fileSizeBytes: verified.size,
    contentHash: verified.content_hash ?? null,
  });

  await adminClient
    .from("job_proofs")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", proofId);

  await logProofActivity(adminClient, {
    activityType: PROOF_ACTIVITY_TYPES.proofCreated,
    description: `Source artwork uploaded for ${proof.proof_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
    actorProfileId,
    metadata: {
      job_id: jobId,
      proof_id: proofId,
      file_name: verified.name,
      source: "source_artwork_upload",
    },
  });

  revalidateJobPages({
    jobId,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
  });

  return { ok: true, fileName: verified.name };
}

export async function loadCustomerProofDownloadFile(
  adminClient: SupabaseClient,
  {
    jobId,
    proofId,
    customerVisible = false,
  }: {
    jobId: string;
    proofId: string;
    customerVisible?: boolean;
  }
) {
  const [{ data: proof, error }, job] = await Promise.all([
    adminClient
      .from("job_proofs")
      .select(PROOF_SELECT)
      .eq("id", proofId)
      .eq("job_id", jobId)
      .maybeSingle(),
    loadJobContext(adminClient, jobId),
  ]);

  if (error || !proof) {
    throw new ProofError("Proof not found.", 404);
  }

  if (
    customerVisible &&
    ["draft", "internal_review", "ready_to_send", "cancelled"].includes(proof.status as string)
  ) {
    throw new ProofError("Proof is not available.", 403);
  }

  const resolved = await resolveCustomerProofDownloadFile(adminClient, {
    jobId,
    proofId,
    versionNumber: proof.version_number as number,
    dropboxFolderPath: job.dropbox_folder_path,
    jobReference: job.job_reference,
    repairStaleReference: true,
  });

  return {
    proof,
    proofFile: {
      id: resolved.id,
      proof_id: resolved.proof_id,
      file_role: "customer_proof" as const,
      job_file_id: null,
      dropbox_file_id: null,
      dropbox_path: resolved.dropbox_path,
      dropbox_revision: null,
      file_name: resolved.file_name,
      mime_type: resolved.mime_type,
      file_size_bytes: resolved.file_size_bytes,
      content_hash: resolved.content_hash,
      preview_dropbox_path: null,
      preview_metadata: null,
      created_at: null,
    },
  };
}

export async function markProofReadyToSend(
  adminClient: SupabaseClient,
  {
    jobId,
    proofId,
    actorProfileId,
  }: {
    jobId: string;
    proofId: string;
    actorProfileId: string;
  }
) {
  const job = await loadJobContext(adminClient, jobId);
  const proof = await loadMutableProof(adminClient, jobId, proofId);

  if (proof.status !== "internal_review") {
    throw new ProofError("Proof must be in internal review before marking ready to send.", 409);
  }

  await assertCustomerFacingProofAttached(
    adminClient,
    proofId,
    job.dropbox_folder_path,
    "Attach a proof PDF or image before marking this proof ready to send."
  );

  const now = new Date().toISOString();

  await adminClient
    .from("job_proofs")
    .update({
      status: "ready_to_send",
      ready_to_send_at: now,
      ready_to_send_by_profile_id: actorProfileId,
      updated_at: now,
    })
    .eq("id", proofId);

  await syncJobProofWorkflowStatus(adminClient, jobId);

  await logProofActivity(adminClient, {
    activityType: PROOF_ACTIVITY_TYPES.proofReadyToSend,
    description: `${proof.proof_reference} marked ready to send.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
    actorProfileId,
    metadata: { job_id: jobId, proof_id: proofId },
  });

  revalidateJobPages({
    jobId,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
  });

  return { ok: true };
}

export async function sendJobProof(
  adminClient: SupabaseClient,
  {
    jobId,
    proofId,
    actorProfileId,
  }: {
    jobId: string;
    proofId: string;
    actorProfileId: string;
  }
) {
  const job = await loadJobContext(adminClient, jobId);
  const proof = await loadMutableProof(adminClient, jobId, proofId);

  if (proof.status !== "ready_to_send") {
    throw new ProofError("Proof must be ready to send before sending to the customer.", 409);
  }

  const sourceArtwork = await loadProofFileRecord(adminClient, proofId, "source_artwork");
  const proofFile = await assertCustomerFacingProofAttached(
    adminClient,
    proofId,
    job.dropbox_folder_path,
    "Attach a proof PDF or image before sending."
  );

  if (
    !proofArtifactMatchesVersion(
      proofFile.file_name as string,
      proofFile.dropbox_path as string,
      proof.version_number as number
    )
  ) {
    throw new ProofError(
      `The customer-facing proof file must match proof v${proof.version_number as number}. Generate the branded PDF for this version before sending.`,
      409
    );
  }

  const proofsFolderPath = resolveProofsFolderPathOrThrow(
    job.dropbox_folder_path,
    job.job_reference,
    job.project_name
  );

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

  let finalMetadata: {
    dropboxFileId: string | null;
    dropboxPath: string;
    dropboxRevision: string | null;
    fileName: string;
    fileSizeBytes: number;
    contentHash: string | null;
  };

  if (sourceArtwork) {
    const metadata = await resolveDropboxFileMetadata(proofFile.dropbox_path as string);
    finalMetadata = {
      dropboxFileId: metadata.id,
      dropboxPath: metadata.path_lower ?? metadata.path_display,
      dropboxRevision: metadata.rev,
      fileName: metadata.name,
      fileSizeBytes: metadata.size,
      contentHash: metadata.content_hash ?? null,
    };
  } else {
    const alreadyInProofsFolder = isPathInProofsFolder(
      proofFile.dropbox_path as string,
      job.dropbox_folder_path,
      job.job_reference,
      job.project_name
    );

    if (alreadyInProofsFolder) {
      const metadata = await resolveDropboxFileMetadata(proofFile.dropbox_path as string);
      finalMetadata = {
        dropboxFileId: metadata.id,
        dropboxPath: metadata.path_lower ?? metadata.path_display,
        dropboxRevision: metadata.rev,
        fileName: metadata.name,
        fileSizeBytes: metadata.size,
        contentHash: metadata.content_hash ?? null,
      };
    } else {
      if (!isCustomerFacingProofExtension(proofFile.file_name as string)) {
        throw new ProofError(
          "Attach a lightweight PDF or image proof before sending. Production artwork files cannot be sent to the customer.",
          409
        );
      }

      const copied = await copyProofFileToProofsFolder({
        sourcePath: proofFile.dropbox_path as string,
        proofsFolderPath,
        versionNumber: proof.version_number,
        itemReference,
        jobReference: job.job_reference,
      });

      finalMetadata = {
        dropboxFileId: copied.dropboxFileId,
        dropboxPath: copied.dropboxPath,
        dropboxRevision: copied.dropboxRevision,
        fileName: copied.fileName,
        fileSizeBytes: copied.fileSizeBytes,
        contentHash: copied.contentHash,
      };
    }
  }

  const now = new Date().toISOString();

  await adminClient
    .from("job_proof_files")
    .update({
      dropbox_file_id: finalMetadata.dropboxFileId,
      dropbox_path: finalMetadata.dropboxPath,
      dropbox_revision: finalMetadata.dropboxRevision,
      file_name: finalMetadata.fileName,
      file_size_bytes: finalMetadata.fileSizeBytes,
      content_hash: finalMetadata.contentHash,
      mime_type: sourceArtwork ? "application/pdf" : proofFile.mime_type,
    })
    .eq("id", proofFile.id);

  await supersedePreviousSentProofs(
    adminClient,
    jobId,
    proofId,
    proof.proof_lineage_id as string,
    now
  );

  await adminClient
    .from("job_proofs")
    .update({
      status: "sent",
      sent_at: now,
      sent_by_profile_id: actorProfileId,
      updated_at: now,
    })
    .eq("id", proofId);

  await syncJobProofWorkflowStatus(adminClient, jobId);

  await logProofActivity(adminClient, {
    activityType: PROOF_ACTIVITY_TYPES.proofSent,
    description: `${proof.proof_reference} sent to customer.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
    actorProfileId,
    metadata: { job_id: jobId, proof_id: proofId },
  });

  prepareProofReadyNotification({
    adminClient,
    companyId: job.company_id,
    jobId,
    proofId,
  }).catch((notificationError) => {
    console.error("[proofs] proof_ready notification failed", {
      jobId,
      proofId,
      message:
        notificationError instanceof Error
          ? notificationError.message
          : "Unable to send proof ready notification.",
    });
  });

  revalidateJobPages({
    jobId,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
  });

  return { ok: true };
}

export async function markProofViewed(
  adminClient: SupabaseClient,
  {
    jobId,
    proofId,
    actorProfileId,
  }: {
    jobId: string;
    proofId: string;
    actorProfileId: string;
  }
) {
  const job = await loadJobContext(adminClient, jobId);
  const { data: proof, error } = await adminClient
    .from("job_proofs")
    .select(PROOF_SELECT)
    .eq("id", proofId)
    .eq("job_id", jobId)
    .maybeSingle();

  if (error || !proof) {
    throw new ProofError("Proof not found.", 404);
  }

  if (!["sent", "viewed"].includes(proof.status)) {
    return { ok: true };
  }

  const now = new Date().toISOString();

  if (proof.status === "sent") {
    await adminClient
      .from("job_proofs")
      .update({ status: "viewed", viewed_at: now, updated_at: now })
      .eq("id", proofId);

    await logProofActivity(adminClient, {
      activityType: PROOF_ACTIVITY_TYPES.proofViewed,
      description: `${proof.proof_reference} viewed by customer.`,
      companyId: job.company_id,
      quoteId: job.quote_id,
      opportunityId: job.opportunity_id,
      actorProfileId,
      metadata: { job_id: jobId, proof_id: proofId },
    });
  }

  return { ok: true };
}

export async function approveJobProof(
  adminClient: SupabaseClient,
  {
    jobId,
    proofId,
    actorProfileId,
    customerEmail,
    confirmationAccepted,
    ipAddress,
    userAgent,
  }: {
    jobId: string;
    proofId: string;
    actorProfileId: string;
    customerEmail: string;
    confirmationAccepted: boolean;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
) {
  if (!confirmationAccepted) {
    throw new ProofError("You must confirm approval before proceeding.", 400);
  }

  const job = await loadJobContext(adminClient, jobId);
  const proof = await loadCustomerActionableProof(adminClient, jobId, proofId);

  const { proofFile } = await loadCustomerProofDownloadFile(adminClient, {
    jobId,
    proofId,
    customerVisible: true,
  });

  const now = new Date().toISOString();

  await adminClient.from("job_proof_approvals").insert({
    proof_id: proofId,
    job_id: jobId,
    profile_id: actorProfileId,
    customer_email: customerEmail,
    confirmation_text: PROOF_CONFIRMATION_TEXT,
    ip_address: ipAddress ?? null,
    user_agent: userAgent ?? null,
    proof_file_metadata: proofFile
      ? {
          file_name: proofFile.file_name,
          dropbox_path: proofFile.dropbox_path,
          content_hash: proofFile.content_hash,
          file_size_bytes: proofFile.file_size_bytes,
        }
      : null,
    approved_at: now,
  });

  await adminClient
    .from("job_proofs")
    .update({
      status: "approved",
      approved_at: now,
      approved_by_profile_id: actorProfileId,
      updated_at: now,
    })
    .eq("id", proofId);

  await adminClient
    .from("jobs")
    .update({
      proof_workflow_status: "approved",
      proof_approved_at: now,
      proof_approved_by_profile_id: actorProfileId,
      current_proof_id: proofId,
      updated_at: now,
    })
    .eq("id", jobId);

  await logProofActivity(adminClient, {
    activityType: PROOF_ACTIVITY_TYPES.proofApproved,
    description: `${proof.proof_reference} approved by customer.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
    actorProfileId,
    metadata: { job_id: jobId, proof_id: proofId, version_number: proof.version_number },
  });

  prepareProofApprovedNotification({
    adminClient,
    companyId: job.company_id,
    jobId,
    proofId,
    actorProfileId,
    customerEmail,
  }).catch((notificationError) => {
    console.error("[proofs] proof_approved notification failed", {
      jobId,
      proofId,
      message:
        notificationError instanceof Error
          ? notificationError.message
          : "Unable to send proof approved notification.",
    });
  });

  revalidateJobPages({
    jobId,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
  });

  return { ok: true };
}

export async function requestJobProofChanges(
  adminClient: SupabaseClient,
  {
    jobId,
    proofId,
    comment,
    actorProfileId,
  }: {
    jobId: string;
    proofId: string;
    comment: string;
    actorProfileId: string;
  }
) {
  const trimmed = comment.trim();
  if (!trimmed) {
    throw new ProofError("Please describe the changes you need.", 400);
  }

  const job = await loadJobContext(adminClient, jobId);
  const proof = await loadCustomerActionableProof(adminClient, jobId, proofId);
  const now = new Date().toISOString();

  await adminClient
    .from("job_proofs")
    .update({
      status: "changes_requested",
      changes_requested_at: now,
      changes_requested_comment: trimmed,
      changes_requested_by_profile_id: actorProfileId,
      updated_at: now,
    })
    .eq("id", proofId);

  await adminClient
    .from("jobs")
    .update({
      proof_workflow_status: "changes_requested",
      proof_approved_at: null,
      proof_approved_by_profile_id: null,
      updated_at: now,
    })
    .eq("id", jobId);

  await logProofActivity(adminClient, {
    activityType: PROOF_ACTIVITY_TYPES.proofChangesRequested,
    description: `Changes requested on ${proof.proof_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
    actorProfileId,
    metadata: { job_id: jobId, proof_id: proofId, comment: trimmed },
  });

  prepareProofChangesRequestedNotification({
    adminClient,
    companyId: job.company_id,
    jobId,
    proofId,
    actorProfileId,
  }).catch((notificationError) => {
    console.error("[proofs] proof_changes_requested notification failed", {
      jobId,
      proofId,
      message:
        notificationError instanceof Error
          ? notificationError.message
          : "Unable to send proof changes requested notification.",
    });
  });

  revalidateJobPages({
    jobId,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
  });

  return { ok: true };
}

export async function resendProofReadyNotification(
  adminClient: SupabaseClient,
  {
    jobId,
    proofId,
    actorProfileId,
  }: {
    jobId: string;
    proofId: string;
    actorProfileId: string;
  }
) {
  const job = await loadJobContext(adminClient, jobId);

  const { data: proof, error } = await adminClient
    .from("job_proofs")
    .select(PROOF_SELECT)
    .eq("id", proofId)
    .eq("job_id", jobId)
    .maybeSingle();

  if (error || !proof) {
    throw new ProofError("Proof not found.", 404);
  }

  if (!["sent", "viewed"].includes(proof.status)) {
    throw new ProofError(
      "Only proofs awaiting customer approval can have their notification resent.",
      409
    );
  }

  await prepareProofReadyResendNotification({
    adminClient,
    companyId: job.company_id,
    jobId,
    proofId,
  }).catch((notificationError) => {
    console.error("[proofs] proof_ready resend notification failed", {
      jobId,
      proofId,
      message:
        notificationError instanceof Error
          ? notificationError.message
          : "Unable to resend proof ready notification.",
    });
  });

  await logProofActivity(adminClient, {
    activityType: PROOF_ACTIVITY_TYPES.proofSent,
    description: `${proof.proof_reference} notification resent to customer.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
    actorProfileId,
    metadata: { job_id: jobId, proof_id: proofId, resend: true },
  });

  revalidateJobPages({
    jobId,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
  });

  return { ok: true };
}

export async function linkJobFileToManifestItems(
  adminClient: SupabaseClient,
  {
    jobId,
    jobFileId,
    productionItemIds,
    actorProfileId,
  }: {
    jobId: string;
    jobFileId: string;
    productionItemIds: string[];
    actorProfileId: string;
  }
) {
  if (!productionItemIds.length) {
    throw new ProofError("Select at least one manifest item.", 400);
  }

  await loadManifestItemsByIds(adminClient, jobId, productionItemIds);

  const { data: file, error: fileError } = await adminClient
    .from("job_files")
    .select("id")
    .eq("id", jobFileId)
    .eq("job_id", jobId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fileError || !file) {
    throw new ProofError("Artwork file not found.", 404);
  }

  const rows = productionItemIds.map((productionItemId) => ({
    job_file_id: jobFileId,
    production_item_id: productionItemId,
    linked_by_profile_id: actorProfileId,
  }));

  const { error } = await adminClient
    .from("job_file_manifest_items")
    .upsert(rows, { onConflict: "job_file_id,production_item_id" });

  if (error) {
    if (isMissingProofSchemaError(error)) {
      throw new ProofError("Artwork linking schema is not deployed.", 503);
    }
    throw new ProofError(error.message, 500);
  }

  return { ok: true };
}

async function loadMutableProof(
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
    [
      "sent",
      "viewed",
      "approved",
      "changes_requested",
      "superseded",
      "cancelled",
    ].includes(data.status)
  ) {
    throw new ProofError("This proof version can no longer be edited.", 409);
  }

  return data;
}

async function loadCustomerActionableProof(
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

  if (!["sent", "viewed"].includes(data.status)) {
    throw new ProofError("This proof cannot be actioned in its current state.", 409);
  }

  const { data: latestSent, error: latestError } = await adminClient
    .from("job_proofs")
    .select("id, version_number")
    .eq("job_id", jobId)
    .eq("proof_lineage_id", data.proof_lineage_id as string)
    .in("status", ["sent", "viewed", "changes_requested"])
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    throw new ProofError(latestError.message, 500);
  }

  if (latestSent && latestSent.id !== proofId) {
    throw new ProofError("Only the latest sent proof can be approved or changed.", 409);
  }

  return data;
}

async function supersedePreviousSentProofs(
  adminClient: SupabaseClient,
  jobId: string,
  currentProofId: string,
  proofLineageId: string,
  now: string
) {
  const { data: previousProofs } = await adminClient
    .from("job_proofs")
    .select("id, proof_reference")
    .eq("job_id", jobId)
    .eq("proof_lineage_id", proofLineageId)
    .neq("id", currentProofId)
    .in("status", ["sent", "viewed", "changes_requested"]);

  if (!previousProofs?.length) {
    return;
  }

  await adminClient
    .from("job_proofs")
    .update({ status: "superseded", superseded_at: now, updated_at: now })
    .in(
      "id",
      previousProofs.map((proof) => proof.id)
    );

  const job = await loadJobContext(adminClient, jobId);

  for (const previous of previousProofs) {
    await logProofActivity(adminClient, {
      activityType: PROOF_ACTIVITY_TYPES.proofSuperseded,
      description: `${previous.proof_reference} superseded by a newer proof.`,
      companyId: job.company_id,
      quoteId: job.quote_id,
      opportunityId: job.opportunity_id,
      metadata: { job_id: jobId, proof_id: previous.id },
    });
  }
}

export async function loadJobFileManifestLinks(
  adminClient: SupabaseClient,
  jobId: string
) {
  const { data: items, error: itemsError } = await adminClient
    .from("production_items")
    .select("id, item_reference, item_name")
    .eq("job_id", jobId)
    .is("deleted_at", null);

  if (itemsError) {
    if (isMissingProofSchemaError(itemsError)) {
      return [];
    }
    return [];
  }

  const itemIds = (items ?? []).map((item) => item.id);
  if (!itemIds.length) {
    return [];
  }

  const { data, error } = await adminClient
    .from("job_file_manifest_items")
    .select("job_file_id, production_item_id")
    .in("production_item_id", itemIds);

  if (error) {
    if (isMissingProofSchemaError(error)) {
      return [];
    }
    return [];
  }

  const itemById = new Map((items ?? []).map((item) => [item.id, item]));

  return (data ?? []).map((row) => {
    const item = itemById.get(row.production_item_id);
    return {
      jobFileId: row.job_file_id as string,
      productionItemId: row.production_item_id as string,
      itemReference: item?.item_reference ?? null,
      itemName: item?.item_name ?? "Item",
    };
  });
}
