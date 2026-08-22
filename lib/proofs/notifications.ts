import type { SupabaseClient } from "@supabase/supabase-js";

import { loadProfileNotificationContext } from "@/lib/notifications/profile-recipient";
import { sendNotification } from "@/lib/notifications/send-notification";
import { PROOF_SELECT } from "@/lib/proofs/constants";

function logProofNotificationFailure(event: string, error: unknown) {
  console.error(`[notifications:proof] ${event}`, {
    message: error instanceof Error ? error.message : String(error),
  });
}

function extractSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function formatProofManifestSummary(
  items: Array<{ item_reference?: string | null; item_name?: string | null }>
) {
  if (!items.length) {
    return "";
  }

  return items
    .map((item) =>
      item.item_reference
        ? `${item.item_reference} · ${item.item_name ?? "Item"}`
        : String(item.item_name ?? "Item")
    )
    .join(", ");
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "Recently";
  }

  return new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function buildCustomerProofUrl(jobId: string, proofId: string) {
  return `/jobs/${jobId}#proof-${proofId}`;
}

async function loadProofNotificationContext(
  adminClient: SupabaseClient,
  {
    jobId,
    proofId,
  }: {
    jobId: string;
    proofId: string;
  }
) {
  const [{ data: job, error: jobError }, { data: proof, error: proofError }] =
    await Promise.all([
      adminClient
        .from("jobs")
        .select(
          "id, job_reference, project_name, company_id, quote_id, opportunity_id, contact_id, companies(company_name), contacts(full_name, email, profile_id)"
        )
        .eq("id", jobId)
        .maybeSingle(),
      adminClient
        .from("job_proofs")
        .select(PROOF_SELECT)
        .eq("id", proofId)
        .eq("job_id", jobId)
        .maybeSingle(),
    ]);

  if (jobError || !job) {
    throw jobError ?? new Error("Job not found.");
  }

  if (proofError || !proof) {
    throw proofError ?? new Error("Proof not found.");
  }

  const { data: itemLinks, error: itemError } = await adminClient
    .from("job_proof_manifest_items")
    .select("production_item_id, production_items(item_reference, item_name)")
    .eq("proof_id", proofId);

  if (itemError) {
    throw itemError;
  }

  const company = extractSingle(job.companies);
  const contact = extractSingle(job.contacts);
  const manifestItems = (itemLinks ?? []).map(
    (link) =>
      extractSingle(link.production_items) as {
        item_reference?: string | null;
        item_name?: string | null;
      } | null
  ).filter(Boolean) as Array<{
    item_reference?: string | null;
    item_name?: string | null;
  }>;

  return {
    job,
    proof,
    companyName: company?.company_name ?? "Customer",
    customerName: contact?.full_name ?? "Customer",
    contactId: (job.contact_id as string | null) ?? null,
    profileId: (contact?.profile_id as string | null) ?? null,
    relatedItems: formatProofManifestSummary(manifestItems),
    proofUrl: buildCustomerProofUrl(jobId, proofId),
    jobUrl: `/jobs/${jobId}`,
    adminJobUrl: `/admin/jobs/${jobId}`,
  };
}

function buildSharedProofMetadata(context: Awaited<ReturnType<typeof loadProofNotificationContext>>) {
  return {
    projectName: context.job.project_name,
    companyName: context.companyName,
    customerName: context.customerName,
    jobReference: context.job.job_reference,
    jobId: context.job.id,
    proofId: context.proof.id,
    proofTitle: context.proof.title,
    proofVersion: `v${context.proof.version_number}`,
    proofReference: context.proof.proof_reference,
    versionNumber: context.proof.version_number,
    relatedItems: context.relatedItems,
    customerMessage: context.proof.customer_message,
    jobUrl: context.jobUrl,
    proofUrl: context.proofUrl,
    adminJobUrl: context.adminJobUrl,
  };
}

export async function notifyProofReady(
  adminClient: SupabaseClient,
  input: {
    companyId: string;
    jobId: string;
    proofId: string;
    resend?: boolean;
  }
) {
  const context = await loadProofNotificationContext(adminClient, input);
  const sharedMetadata = buildSharedProofMetadata(context);

  if (!["sent", "viewed"].includes(context.proof.status)) {
    return { ok: false as const, skippedReason: "proof_not_sent" };
  }

  const idempotencyKey = input.resend
    ? `proof_ready_resend:${input.proofId}:${Date.now()}`
    : `proof_ready:${input.proofId}:${context.proof.version_number}`;

  return sendNotification(adminClient, {
    type: "proof_ready",
    companyId: input.companyId,
    contactId: context.contactId,
    profileId: context.profileId,
    jobId: input.jobId,
    quoteId: context.job.quote_id as string | null,
    opportunityId: context.job.opportunity_id as string | null,
    idempotencyKey,
    metadata: {
      ...sharedMetadata,
      resend: Boolean(input.resend),
    },
  });
}

export async function notifyProofReadySafe(
  adminClient: SupabaseClient,
  input: {
    companyId: string;
    jobId: string;
    proofId: string;
    resend?: boolean;
  }
) {
  try {
    return await notifyProofReady(adminClient, input);
  } catch (error) {
    logProofNotificationFailure("proof_ready", error);
    return {
      ok: false,
      skippedReason: error instanceof Error ? error.message : "notification_failed",
    };
  }
}

export async function notifyProofApproved(
  adminClient: SupabaseClient,
  input: {
    companyId: string;
    jobId: string;
    proofId: string;
    actorProfileId: string;
    customerEmail: string;
  }
) {
  const context = await loadProofNotificationContext(adminClient, input);
  const sharedMetadata = buildSharedProofMetadata(context);

  const approver = await loadProfileNotificationContext(adminClient, input.actorProfileId);
  const approvedBy = approver?.fullName ?? input.customerEmail;
  const approvedAt = formatTimestamp(context.proof.approved_at);

  const approvalMetadata = {
    ...sharedMetadata,
    approvedBy,
    approvedAt,
    customerEmail: input.customerEmail,
  };

  const [customerResult, internalResult] = await Promise.all([
    sendNotification(adminClient, {
      type: "proof_approved_customer",
      companyId: input.companyId,
      contactId: context.contactId,
      profileId: input.actorProfileId,
      jobId: input.jobId,
      quoteId: context.job.quote_id as string | null,
      opportunityId: context.job.opportunity_id as string | null,
      idempotencyKey: `proof_approved_customer:${input.proofId}`,
      metadata: approvalMetadata,
    }),
    sendNotification(adminClient, {
      type: "proof_approved_internal",
      companyId: input.companyId,
      jobId: input.jobId,
      quoteId: context.job.quote_id as string | null,
      opportunityId: context.job.opportunity_id as string | null,
      idempotencyKey: `proof_approved_internal:${input.proofId}`,
      metadata: {
        ...approvalMetadata,
        jobUrl: context.adminJobUrl,
      },
    }),
  ]);

  return { customerResult, internalResult };
}

export async function notifyProofApprovedSafe(
  adminClient: SupabaseClient,
  input: {
    companyId: string;
    jobId: string;
    proofId: string;
    actorProfileId: string;
    customerEmail: string;
  }
) {
  try {
    return await notifyProofApproved(adminClient, input);
  } catch (error) {
    logProofNotificationFailure("proof_approved", error);
    return {
      ok: false,
      skippedReason: error instanceof Error ? error.message : "notification_failed",
    };
  }
}

export async function notifyProofChangesRequested(
  adminClient: SupabaseClient,
  input: {
    companyId: string;
    jobId: string;
    proofId: string;
    actorProfileId: string;
  }
) {
  const context = await loadProofNotificationContext(adminClient, input);
  const sharedMetadata = buildSharedProofMetadata(context);
  const customerComment = context.proof.changes_requested_comment ?? "";
  const requestedAt = formatTimestamp(context.proof.changes_requested_at);

  const changesMetadata = {
    ...sharedMetadata,
    customerComment,
    requestedAt,
  };

  const [customerResult, internalResult] = await Promise.all([
    sendNotification(adminClient, {
      type: "proof_changes_requested_customer",
      companyId: input.companyId,
      contactId: context.contactId,
      profileId: input.actorProfileId,
      jobId: input.jobId,
      quoteId: context.job.quote_id as string | null,
      opportunityId: context.job.opportunity_id as string | null,
      idempotencyKey: `proof_changes_requested_customer:${input.proofId}`,
      metadata: changesMetadata,
    }),
    sendNotification(adminClient, {
      type: "proof_changes_requested_internal",
      companyId: input.companyId,
      jobId: input.jobId,
      quoteId: context.job.quote_id as string | null,
      opportunityId: context.job.opportunity_id as string | null,
      idempotencyKey: `proof_changes_requested_internal:${input.proofId}`,
      metadata: {
        ...changesMetadata,
        jobUrl: context.adminJobUrl,
      },
    }),
  ]);

  return { customerResult, internalResult };
}

export async function notifyProofChangesRequestedSafe(
  adminClient: SupabaseClient,
  input: {
    companyId: string;
    jobId: string;
    proofId: string;
    actorProfileId: string;
  }
) {
  try {
    return await notifyProofChangesRequested(adminClient, input);
  } catch (error) {
    logProofNotificationFailure("proof_changes_requested", error);
    return {
      ok: false,
      skippedReason: error instanceof Error ? error.message : "notification_failed",
    };
  }
}

export async function prepareProofReadyNotification(input: {
  adminClient: SupabaseClient;
  companyId: string;
  jobId: string;
  proofId: string;
  resend?: boolean;
}) {
  await notifyProofReadySafe(input.adminClient, input);
}

export async function prepareProofApprovedNotification(input: {
  adminClient: SupabaseClient;
  companyId: string;
  jobId: string;
  proofId: string;
  actorProfileId: string;
  customerEmail: string;
}) {
  await notifyProofApprovedSafe(input.adminClient, input);
}

export async function prepareProofChangesRequestedNotification(input: {
  adminClient: SupabaseClient;
  companyId: string;
  jobId: string;
  proofId: string;
  actorProfileId: string;
}) {
  await notifyProofChangesRequestedSafe(input.adminClient, input);
}

export async function prepareProofReadyResendNotification(input: {
  adminClient: SupabaseClient;
  companyId: string;
  jobId: string;
  proofId: string;
}) {
  await notifyProofReadySafe(input.adminClient, {
    ...input,
    resend: true,
  });
}
