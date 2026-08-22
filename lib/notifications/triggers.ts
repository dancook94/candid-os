import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdminArtworkSourceLabel } from "@/lib/jobs/artwork-source";
import type { JobArtworkSource } from "@/lib/jobs/types";
import { loadProfileNotificationContext } from "@/lib/notifications/profile-recipient";
import {
  getSkippedReasonLabel,
  toAdminSafeNotificationFailureReason,
} from "@/lib/notifications/errors";
import { sendNotification } from "@/lib/notifications/send-notification";
import { buildAbsoluteUrl } from "@/lib/notifications/templates";

function logNotificationFailure(event: string, error: unknown) {
  console.error(`[notifications] ${event}`, {
    message: error instanceof Error ? error.message : String(error),
  });
}

function logNotificationEvent(
  event: string,
  details: Record<string, unknown>
) {
  if (process.env.NODE_ENV === "development") {
    console.info(`[notifications] ${event}`, details);
  }
}

function extractSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function formatQuoteReference(quoteNumber: unknown) {
  if (quoteNumber == null) return "";
  return `Q-${quoteNumber}`;
}

function formatMoney(value: unknown) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(amount);
}

function formatDisplayDate(value: string | null | undefined) {
  if (!value) return "Recently";

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function buildQuoteAcceptedNextStep(job: {
  artwork_required: boolean | null;
  artwork_source: string | null;
  artwork_status: string | null;
}) {
  switch (job.artwork_source) {
    case "portal_upload":
    case "customer_pending":
      return "Your job is now live. You can upload any required artwork from the job page.";
    case "candid_creating":
      return "Your job is now live and our team will prepare the artwork.";
    case "manual_receipt":
      return "Your job is now live and your artwork has been received.";
    default:
      if (job.artwork_required) {
        return "Your job is now live. You can upload any required artwork from the job page.";
      }

      return "Your job is now live and we'll keep you updated as production progresses.";
  }
}

function formatDeliveryAddress(snapshot: {
  delivery_address_line_1?: string | null;
  delivery_address_line_2?: string | null;
  delivery_city?: string | null;
  delivery_county?: string | null;
  delivery_postcode?: string | null;
}) {
  return [
    snapshot.delivery_address_line_1,
    snapshot.delivery_address_line_2,
    snapshot.delivery_city,
    snapshot.delivery_county,
    snapshot.delivery_postcode,
  ]
    .filter(Boolean)
    .join(", ");
}

function formatQuoteTotalLabel(version: {
  total: unknown;
  vat_amount?: unknown;
  subtotal?: unknown;
}) {
  const total = formatMoney(version.total);

  if (version.vat_amount != null && Number(version.vat_amount) > 0) {
    return `${total} including VAT`;
  }

  return total;
}

export async function notifyCustomerRegistration(
  adminClient: SupabaseClient,
  profileId: string
) {
  const profile = await loadProfileNotificationContext(adminClient, profileId);

  if (!profile || profile.userRole !== "customer") {
    logNotificationEvent("registration_skipped", {
      profileId,
      reason: "missing_or_non_customer_profile",
    });
    return { ok: false as const, skippedReason: "missing_or_non_customer_profile" };
  }

  const companyLabel =
    profile.companyName ?? profile.requestedCompanyName ?? "Not assigned yet";

  const registrationMetadata = {
    customerName: profile.fullName ?? profile.firstName ?? "there",
    firstName: profile.firstName ?? "there",
    companyName: companyLabel,
    email: profile.email,
    registrationDate: formatDisplayDate(profile.createdAt),
    accountStatus: profile.accountStatus,
    approvalCopy:
      profile.accountStatus === "approved"
        ? "Your account is already approved and ready to use."
        : "Candid Creative will review your account before portal access is approved.",
  };

  const [customerResult, internalResult] = await Promise.all([
    sendNotification(adminClient, {
      type: "customer_registration_received",
      profileId: profile.id,
      companyId: profile.companyId,
      idempotencyKey: `registration_received:${profile.id}`,
      metadata: registrationMetadata,
    }),
    sendNotification(adminClient, {
      type: "internal_new_registration",
      profileId: profile.id,
      companyId: profile.companyId,
      idempotencyKey: `internal_registration:${profile.id}`,
      metadata: registrationMetadata,
    }),
  ]);

  logNotificationEvent("registration_sent", {
    profileId,
    customerOk: customerResult.ok,
    internalOk: internalResult.ok,
    customerNotificationIds: customerResult.notificationIds,
    internalNotificationIds: internalResult.notificationIds,
    customerSkippedReason: customerResult.skippedReason ?? null,
    internalSkippedReason: internalResult.skippedReason ?? null,
  });

  return {
    ok: customerResult.ok || internalResult.ok,
    customerResult,
    internalResult,
  };
}

export async function notifyCustomerRegistrationSafe(
  adminClient: SupabaseClient,
  profileId: string
) {
  try {
    return await notifyCustomerRegistration(adminClient, profileId);
  } catch (error) {
    logNotificationFailure("customer_registration", error);
    return {
      ok: false,
      skippedReason: error instanceof Error ? error.message : "notification_failed",
    };
  }
}

export async function notifyCustomerAccountApproved(
  adminClient: SupabaseClient,
  profileId: string,
  options?: { resend?: boolean }
) {
  const profile = await loadProfileNotificationContext(adminClient, profileId);

  if (!profile || profile.userRole !== "customer") {
    logNotificationEvent("account_approved_skipped", {
      profileId,
      reason: "missing_or_non_customer_profile",
    });
    return { ok: false as const, skippedReason: "missing_or_non_customer_profile" };
  }

  if (profile.accountStatus !== "approved") {
    logNotificationEvent("account_approved_skipped", {
      profileId,
      reason: "customer_not_approved",
      accountStatus: profile.accountStatus,
    });
    return { ok: false as const, skippedReason: "customer_not_approved" };
  }

  const idempotencyKey = options?.resend
    ? `account_approved_resend:${profile.id}:${Date.now()}`
    : `account_approved:${profile.id}`;

  const result = await sendNotification(adminClient, {
    type: "customer_account_approved",
    profileId: profile.id,
    companyId: profile.companyId,
    idempotencyKey,
    metadata: {
      customerName: profile.fullName ?? profile.firstName ?? "there",
      firstName: profile.firstName ?? "there",
      companyName: profile.companyName ?? profile.requestedCompanyName ?? "Your company",
      email: profile.email,
    },
  });

  logNotificationEvent("account_approved_sent", {
    profileId,
    resend: Boolean(options?.resend),
    ok: result.ok,
    notificationIds: result.notificationIds,
    skippedReason: result.skippedReason ?? null,
    failureReason: result.failureReason ?? null,
    adminMessage: result.adminMessage ?? null,
  });

  return result;
}

export async function notifyCustomerAccountApprovedSafe(
  adminClient: SupabaseClient,
  profileId: string,
  options?: { resend?: boolean }
) {
  try {
    return await notifyCustomerAccountApproved(adminClient, profileId, options);
  } catch (error) {
    logNotificationFailure("customer_account_approved", error);
    const adminFailure = toAdminSafeNotificationFailureReason(error);

    return {
      ok: false,
      notificationIds: [],
      results: [],
      skippedReason: adminFailure.reason,
      failureReason: adminFailure.reason,
      adminMessage: adminFailure.message,
    };
  }
}

export async function notifyQuoteReady(
  adminClient: SupabaseClient,
  input: { quoteId: string; contactId?: string | null; versionId?: string | null }
) {
  const { data: quote, error } = await adminClient
    .from("quotes")
    .select(
      "id, company_id, contact_id, project_name, quote_number, status, contacts(full_name, email, profile_id), companies(company_name)"
    )
    .eq("id", input.quoteId)
    .maybeSingle();

  if (error || !quote) {
    throw error ?? new Error("Quote not found.");
  }

  if (quote.status === "draft") {
    logNotificationEvent("quote_ready_skipped", {
      quoteId: input.quoteId,
      reason: "quote_is_draft",
    });
    return { ok: false as const, skippedReason: "quote_is_draft" };
  }

  let versionQuery = adminClient
    .from("quote_versions")
    .select("id, version_number, total, subtotal, vat_amount, version_status")
    .eq("quote_id", input.quoteId)
    .eq("version_status", "sent");

  if (input.versionId) {
    versionQuery = versionQuery.eq("id", input.versionId);
  } else {
    versionQuery = versionQuery
      .order("version_number", { ascending: false })
      .limit(1);
  }

  const { data: version } = await versionQuery.maybeSingle();

  if (!version || version.version_status !== "sent") {
    logNotificationEvent("quote_ready_skipped", {
      quoteId: input.quoteId,
      reason: "no_sent_version",
    });
    return { ok: false as const, skippedReason: "no_sent_version" };
  }

  const company = extractSingle(quote.companies);
  const contact = extractSingle(quote.contacts);

  return sendNotification(adminClient, {
    type: "quote_ready",
    companyId: quote.company_id as string,
    contactId: (input.contactId ?? quote.contact_id) as string | null,
    profileId: (contact?.profile_id as string | null) ?? null,
    quoteId: quote.id as string,
    idempotencyKey: `quote_ready:${quote.id}:${version.id}`,
    metadata: {
      projectName: quote.project_name,
      companyName: company?.company_name ?? "Your company",
      customerName: contact?.full_name ?? "there",
      quoteReference: formatQuoteReference(quote.quote_number),
      quoteTotal: formatQuoteTotalLabel(version),
      quoteVersion: `Version ${version.version_number}`,
      quoteId: quote.id,
      quoteUrl: `/quotes/${quote.id}`,
    },
  });
}

export async function notifyQuoteReadySafe(
  adminClient: SupabaseClient,
  input: { quoteId: string; contactId?: string | null; versionId?: string | null }
) {
  try {
    return await notifyQuoteReady(adminClient, input);
  } catch (error) {
    logNotificationFailure("quote_ready", error);
    return {
      ok: false,
      notificationIds: [],
      results: [],
      skippedReason: error instanceof Error ? error.message : "notification_failed",
    };
  }
}

export async function notifyQuoteAccepted(
  adminClient: SupabaseClient,
  input: {
    quoteId: string;
    jobId: string;
    companyId: string;
    contactId?: string | null;
    opportunityId?: string | null;
  }
) {
  const [{ data: quote }, { data: job }] = await Promise.all([
    adminClient
      .from("quotes")
      .select(
        "id, project_name, quote_number, total, required_date, fulfilment_method, quote_request_id, companies(company_name), contacts(full_name, email, profile_id)"
      )
      .eq("id", input.quoteId)
      .maybeSingle(),
    adminClient
      .from("jobs")
      .select(
        "id, job_reference, artwork_required, artwork_status, artwork_source, fulfilment_method, required_date"
      )
      .eq("id", input.jobId)
      .maybeSingle(),
  ]);

  if (!quote || !job) {
    return { ok: false as const, skippedReason: "quote_or_job_missing" };
  }

  let purchaseOrderNumber: string | null = null;

  if (quote.quote_request_id) {
    const { data: quoteRequest } = await adminClient
      .from("quote_requests")
      .select("purchase_order_number")
      .eq("id", quote.quote_request_id as string)
      .maybeSingle();

    purchaseOrderNumber = (quoteRequest?.purchase_order_number as string | null) ?? null;
  }

  const company = extractSingle(quote.companies);
  const contact = extractSingle(quote.contacts);
  const nextStep = buildQuoteAcceptedNextStep(job);
  const artworkStatusLabel = job.artwork_source
    ? getAdminArtworkSourceLabel(job.artwork_source as JobArtworkSource)
    : job.artwork_required
      ? "Awaiting customer artwork"
      : "Not required";

  const sharedMetadata = {
    projectName: quote.project_name,
    companyName: company?.company_name ?? "Your company",
    customerName: contact?.full_name ?? "Customer",
    jobReference: job.job_reference,
    quoteReference: formatQuoteReference(quote.quote_number),
    jobId: job.id,
    acceptedValue: formatMoney(quote.total),
    requiredDate: quote.required_date ?? job.required_date ?? "Not specified",
    fulfilmentMethod: quote.fulfilment_method ?? job.fulfilment_method ?? "Not specified",
    artworkStatusLabel,
    purchaseOrderNumber: purchaseOrderNumber ?? "Not supplied",
    nextStep,
  };

  const profileId = (contact?.profile_id as string | null) ?? null;

  const [customerResult, internalResult] = await Promise.all([
    sendNotification(adminClient, {
      type: "quote_accepted_customer",
      companyId: input.companyId,
      contactId: input.contactId ?? null,
      profileId,
      quoteId: input.quoteId,
      jobId: input.jobId,
      idempotencyKey: `quote_accepted_customer:${input.quoteId}`,
      metadata: {
        ...sharedMetadata,
        jobUrl: `/jobs/${job.id}`,
      },
    }),
    sendNotification(adminClient, {
      type: "quote_accepted_internal",
      companyId: input.companyId,
      contactId: input.contactId ?? null,
      quoteId: input.quoteId,
      jobId: input.jobId,
      opportunityId: input.opportunityId ?? null,
      idempotencyKey: `quote_accepted_internal:${input.quoteId}`,
      metadata: {
        ...sharedMetadata,
        jobUrl: `/admin/jobs/${job.id}`,
        opportunityUrl: input.opportunityId
          ? `/admin/opportunities/${input.opportunityId}`
          : null,
      },
    }),
  ]);

  logNotificationEvent("quote_accepted_sent", {
    quoteId: input.quoteId,
    jobId: input.jobId,
    customerOk: customerResult.ok,
    internalOk: internalResult.ok,
  });

  return {
    ok: customerResult.ok && internalResult.ok,
    customerResult,
    internalResult,
  };
}

export async function notifyQuoteAcceptedSafe(
  adminClient: SupabaseClient,
  input: {
    quoteId: string;
    jobId: string;
    companyId: string;
    contactId?: string | null;
    opportunityId?: string | null;
  }
) {
  try {
    return await notifyQuoteAccepted(adminClient, input);
  } catch (error) {
    logNotificationFailure("quote_accepted", error);
    return {
      ok: false,
      skippedReason: error instanceof Error ? error.message : "notification_failed",
    };
  }
}

export async function notifyArtworkUploaded(
  adminClient: SupabaseClient,
  input: { companyId: string; jobId: string; fileId: string }
) {
  const { data: job, error } = await adminClient
    .from("jobs")
    .select(
      "id, job_reference, project_name, quote_id, opportunity_id, contact_id, companies(company_name), contacts(full_name, email)"
    )
    .eq("id", input.jobId)
    .maybeSingle();

  if (error || !job) {
    throw error ?? new Error("Job not found.");
  }

  const { data: file } = await adminClient
    .from("job_files")
    .select("id, file_name")
    .eq("id", input.fileId)
    .maybeSingle();

  const company = extractSingle(job.companies);
  const contact = extractSingle(job.contacts);
  const fileSummary = file?.file_name ?? "Artwork uploaded";

  const sharedMetadata = {
    projectName: job.project_name,
    companyName: company?.company_name ?? "Customer",
    customerName: contact?.full_name ?? "Customer",
    jobReference: job.job_reference,
    jobId: job.id,
    fileSummary,
  };

  await sendNotification(adminClient, {
    type: "artwork_uploaded_confirmation",
    companyId: input.companyId,
    contactId: job.contact_id as string | null,
    jobId: job.id as string,
    quoteId: job.quote_id as string | null,
    idempotencyKey: `artwork_upload:${input.fileId}`,
    metadata: {
      ...sharedMetadata,
      jobUrl: `/jobs/${job.id}`,
    },
  });

  await sendNotification(adminClient, {
    type: "artwork_uploaded",
    companyId: input.companyId,
    contactId: job.contact_id as string | null,
    jobId: job.id as string,
    quoteId: job.quote_id as string | null,
    opportunityId: job.opportunity_id as string | null,
    idempotencyKey: `artwork_upload_internal:${input.fileId}`,
    metadata: {
      ...sharedMetadata,
      jobUrl: `/admin/jobs/${job.id}`,
    },
  });
}

export async function notifyArtworkUploadedSafe(
  adminClient: SupabaseClient,
  input: { companyId: string; jobId: string; fileId: string }
) {
  try {
    await notifyArtworkUploaded(adminClient, input);
  } catch (error) {
    logNotificationFailure("artwork_uploaded", error);
  }
}

export async function notifyInternalQuoteRequestReceived(
  adminClient: SupabaseClient,
  input: { quoteRequestId: string; companyId: string; contactId: string }
) {
  const { data: quoteRequest, error } = await adminClient
    .from("quote_requests")
    .select(
      "id, project_name, description, fulfilment_method, requested_date, requested_time, request_status, created_at, purchase_order_number, notes, delivery_address_line_1, delivery_address_line_2, delivery_city, delivery_county, delivery_postcode, companies(company_name), contacts(full_name, email)"
    )
    .eq("id", input.quoteRequestId)
    .maybeSingle();

  if (error || !quoteRequest) {
    throw error ?? new Error("Quote request not found.");
  }

  if (quoteRequest.request_status !== "submitted") {
    logNotificationEvent("quote_request_notification_skipped", {
      quoteRequestId: input.quoteRequestId,
      reason: "not_submitted",
      requestStatus: quoteRequest.request_status,
    });
    return { ok: false as const, skippedReason: "not_submitted" };
  }

  const { count: attachmentCount } = await adminClient
    .from("quote_request_attachments")
    .select("id", { count: "exact", head: true })
    .eq("quote_request_id", input.quoteRequestId);

  const company = extractSingle(quoteRequest.companies);
  const contact = extractSingle(quoteRequest.contacts);
  const deliveryAddress =
    quoteRequest.fulfilment_method === "delivery"
      ? formatDeliveryAddress(quoteRequest)
      : null;

  return sendNotification(adminClient, {
    type: "internal_quote_request_received",
    companyId: input.companyId,
    contactId: input.contactId,
    quoteRequestId: input.quoteRequestId,
    idempotencyKey: `quote_request_submitted:${input.quoteRequestId}`,
    metadata: {
      projectName: quoteRequest.project_name,
      companyName: company?.company_name ?? "Customer",
      customerName: contact?.full_name ?? "Customer",
      requiredDate: quoteRequest.requested_date ?? "Not specified",
      requiredTime: quoteRequest.requested_time ?? "Not specified",
      fulfilmentMethod:
        quoteRequest.fulfilment_method === "delivery" ? "Delivery" : "Collection",
      deliveryAddress: deliveryAddress || null,
      purchaseOrderNumber: quoteRequest.purchase_order_number ?? null,
      customerNotes: quoteRequest.notes ?? null,
      attachmentCount: String(attachmentCount ?? 0),
      submittedAt: formatDisplayDate(quoteRequest.created_at as string),
      quoteRequestId: quoteRequest.id,
      quoteRequestUrl: `/admin/quote-requests/${quoteRequest.id}`,
    },
  });
}

export async function notifyInternalQuoteRequestReceivedSafe(
  adminClient: SupabaseClient,
  input: { quoteRequestId: string; companyId: string; contactId: string }
) {
  try {
    return await notifyInternalQuoteRequestReceived(adminClient, input);
  } catch (error) {
    logNotificationFailure("internal_quote_request_received", error);
    return {
      ok: false,
      notificationIds: [],
      results: [],
      skippedReason: error instanceof Error ? error.message : "notification_failed",
    };
  }
}

/** @deprecated Use notifyInternalQuoteRequestReceived */
export async function notifyNewQuoteRequest(
  adminClient: SupabaseClient,
  input: { quoteRequestId: string; companyId: string; contactId: string }
) {
  return notifyInternalQuoteRequestReceived(adminClient, input);
}

export async function notifyNewQuoteRequestSafe(
  adminClient: SupabaseClient,
  input: { quoteRequestId: string; companyId: string; contactId: string }
) {
  return notifyInternalQuoteRequestReceivedSafe(adminClient, input);
}

export async function notifyJobReadyForInvoice(
  adminClient: SupabaseClient,
  input: { jobId: string; invoiceDraftId: string; unpricedCount?: number }
) {
  const { data: job, error } = await adminClient
    .from("jobs")
    .select("id, job_reference, project_name, company_id, quote_id, companies(company_name)")
    .eq("id", input.jobId)
    .maybeSingle();

  if (error || !job) {
    throw error ?? new Error("Job not found.");
  }

  const [{ data: draft }, { data: quote }] = await Promise.all([
    adminClient
      .from("job_invoice_drafts")
      .select("id, subtotal, total, job_id")
      .eq("id", input.invoiceDraftId)
      .maybeSingle(),
    job.quote_id
      ? adminClient.from("quotes").select("total").eq("id", job.quote_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const company = extractSingle(job.companies);

  await sendNotification(adminClient, {
    type: "job_ready_for_invoice",
    companyId: job.company_id as string,
    jobId: job.id as string,
    quoteId: job.quote_id as string | null,
    invoiceDraftId: input.invoiceDraftId,
    idempotencyKey: `job_ready_for_invoice:${job.id}`,
    metadata: {
      projectName: job.project_name,
      companyName: company?.company_name ?? "Company",
      jobReference: job.job_reference,
      jobId: job.id,
      originalQuoteValue: formatMoney(quote?.total ?? null),
      additionsValue: formatMoney(
        Math.max(Number(draft?.total ?? 0) - Number(quote?.total ?? 0), 0)
      ),
      cancellationsValue: "—",
      unpricedCount: input.unpricedCount ?? 0,
      invoiceUrl: `/admin/jobs/${job.id}/invoice`,
    },
  });
}

export async function notifyJobReadyForInvoiceSafe(
  adminClient: SupabaseClient,
  input: { jobId: string; invoiceDraftId: string; unpricedCount?: number }
) {
  try {
    await notifyJobReadyForInvoice(adminClient, input);
  } catch (error) {
    logNotificationFailure("job_ready_for_invoice", error);
  }
}

export { buildAbsoluteUrl };
