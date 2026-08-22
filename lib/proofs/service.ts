import type { SupabaseClient } from "@supabase/supabase-js";

import { revalidateJobPages } from "@/lib/jobs/revalidation";
import { ProofError, isMissingProofSchemaError } from "@/lib/proofs/errors";
import {
  PROOF_ACTIVITY_TYPES,
  PROOF_BYPASS_REASON_LABELS,
  PROOF_CONFIRMATION_TEXT,
  PROOF_FILE_SELECT,
  PROOF_SELECT,
  type ProofArtworkOrigin,
  type ProofBypassReason,
  type ProofInternalChecklistKey,
} from "@/lib/proofs/constants";
import { logProofActivity } from "@/lib/proofs/activity";
import {
  copyProofFileToProofsFolder,
  resolveDropboxFileMetadata,
} from "@/lib/proofs/dropbox";
import { syncJobProofWorkflowStatus } from "@/lib/proofs/gates";
import {
  prepareProofApprovedNotification,
  prepareProofChangesRequestedNotification,
  prepareProofReadyNotification,
} from "@/lib/proofs/notifications";
import type { CreateProofInput, JobProofView } from "@/lib/proofs/types";

type JobContext = {
  id: string;
  company_id: string;
  quote_id: string;
  opportunity_id: string | null;
  job_reference: string;
  project_name: string;
  proof_required: boolean;
};

async function loadJobContext(
  adminClient: SupabaseClient,
  jobId: string
): Promise<JobContext> {
  const { data, error } = await adminClient
    .from("jobs")
    .select(
      "id, company_id, quote_id, opportunity_id, job_reference, project_name, proof_required"
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

async function nextProofVersion(adminClient: SupabaseClient, jobId: string) {
  const { data } = await adminClient
    .from("job_proofs")
    .select("version_number")
    .eq("job_id", jobId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.version_number ?? 0) + 1;
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
  const { data: proofs, error } = await adminClient
    .from("job_proofs")
    .select(PROOF_SELECT)
    .eq("job_id", jobId)
    .order("version_number", { ascending: false });

  if (error) {
    if (isMissingProofSchemaError(error)) {
      return { schemaMissing: true, proofs: [] };
    }
    throw new ProofError(error.message, 500);
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

  const manifestById = new Map((manifestItems ?? []).map((item) => [item.id, item]));

  return {
    schemaMissing: false,
    proofs: (proofs ?? []).map((proof) => {
      const linkedItemIds = (itemLinks ?? [])
        .filter((link) => link.proof_id === proof.id)
        .map((link) => link.production_item_id);

      const mapped: JobProofView = {
        ...(proof as JobProofView),
        files: (files ?? []).filter((file) => file.proof_id === proof.id),
        manifestItems: linkedItemIds
          .map((id) => manifestById.get(id))
          .filter(Boolean) as JobProofView["manifestItems"],
      };

      if (options.customerSafe) {
        mapped.internal_note = null;
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
      "proof_required, proof_workflow_status, proof_bypass_reason, proof_bypassed_at, proof_approved_at"
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
    proofRequired: Boolean(data?.proof_required ?? true),
    workflowStatus: (data?.proof_workflow_status ?? "no_proof") as string,
    bypassReason: data?.proof_bypass_reason ?? null,
    bypassedAt: data?.proof_bypassed_at ?? null,
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

  const manifestItems = await loadManifestItemsByIds(
    adminClient,
    jobId,
    input.productionItemIds
  );
  const sourceFile = await resolveSourceFileMetadata(adminClient, job, input);
  const versionNumber = await nextProofVersion(adminClient, jobId);
  const proofReference = `${job.job_reference} Proof v${versionNumber}`;
  const now = new Date().toISOString();

  const { data: proof, error } = await adminClient
    .from("job_proofs")
    .insert({
      job_id: jobId,
      company_id: job.company_id,
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

  const { error: fileError } = await adminClient.from("job_proof_files").insert({
    proof_id: proof.id,
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

  const { data: proofFile } = await adminClient
    .from("job_proof_files")
    .select(PROOF_FILE_SELECT)
    .eq("proof_id", proofId)
    .limit(1)
    .maybeSingle();

  if (!proofFile?.dropbox_path) {
    throw new ProofError("Proof file metadata is missing.", 409);
  }

  const { data: itemLinks } = await adminClient
    .from("job_proof_manifest_items")
    .select("production_item_id, production_items(item_reference)")
    .eq("proof_id", proofId)
    .limit(1);

  const itemReference =
    (itemLinks?.[0]?.production_items as { item_reference?: string | null } | null)
      ?.item_reference ?? null;

  const copied = await copyProofFileToProofsFolder({
    sourcePath: proofFile.dropbox_path,
    jobReference: job.job_reference,
    projectName: job.project_name,
    versionNumber: proof.version_number,
    itemReference,
    fileName: proofFile.file_name,
  });

  const now = new Date().toISOString();

  await adminClient
    .from("job_proof_files")
    .update({
      dropbox_file_id: copied.dropboxFileId,
      dropbox_path: copied.dropboxPath,
      dropbox_revision: copied.dropboxRevision,
      file_name: copied.fileName,
      file_size_bytes: copied.fileSizeBytes,
    })
    .eq("id", proofFile.id);

  await supersedePreviousSentProofs(adminClient, jobId, proofId, now);

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
    companyId: job.company_id,
    jobId,
    proofId,
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

  const { data: proofFile } = await adminClient
    .from("job_proof_files")
    .select(PROOF_FILE_SELECT)
    .eq("proof_id", proofId)
    .limit(1)
    .maybeSingle();

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
    companyId: job.company_id,
    jobId,
    proofId,
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
    companyId: job.company_id,
    jobId,
    proofId,
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

  if (["sent", "viewed", "approved", "superseded", "cancelled"].includes(data.status)) {
    throw new ProofError("This proof version can no longer be edited.", 409);
  }

  return data;
}

async function loadCustomerActionableProof(
  adminClient: SupabaseClient,
  jobId: string,
  proofId: string
) {
  const { data: latestSent, error: latestError } = await adminClient
    .from("job_proofs")
    .select("id, version_number")
    .eq("job_id", jobId)
    .in("status", ["sent", "viewed", "changes_requested"])
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    throw new ProofError(latestError.message, 500);
  }

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

  if (latestSent && latestSent.id !== proofId) {
    throw new ProofError("Only the latest sent proof can be approved or changed.", 409);
  }

  return data;
}

async function supersedePreviousSentProofs(
  adminClient: SupabaseClient,
  jobId: string,
  currentProofId: string,
  now: string
) {
  const { data: previousProofs } = await adminClient
    .from("job_proofs")
    .select("id, proof_reference")
    .eq("job_id", jobId)
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
