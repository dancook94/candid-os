import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdminArtworkSourceLabel } from "@/lib/jobs/artwork-source";
import type { JobArtworkSource } from "@/lib/jobs/types";
import { loadProfileNotificationContext } from "@/lib/notifications/profile-recipient";
import { sendNotification } from "@/lib/notifications/send-notification";
import { buildAbsoluteUrl } from "@/lib/notifications/templates";

function logNotificationFailure(event: string, error: unknown) {
  if (process.env.NODE_ENV === "development") {
    console.error(`[notifications] ${event}`, {
      message: error instanceof Error ? error.message : String(error),
    });
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
  if (job.artwork_source === "candid_creating") {
    return "Your job has now been created and our team will prepare the artwork.";
  }

  if (
    job.artwork_source === "manual_receipt" ||
    job.artwork_source === "portal_upload" ||
    job.artwork_status === "received" ||
    job.artwork_status === "uploaded"
  ) {
    return "Your job has now been created and we'll continue preparing it for production.";
  }

  if (job.artwork_required) {
    return "Your job has now been created. You can upload artwork from the job page.";
  }

  return "Your job has now been created and we'll keep you updated as production progresses.";
}

export async function notifyCustomerRegistration(
  adminClient: SupabaseClient,
  profileId: string
) {
  const profile = await loadProfileNotificationContext(adminClient, profileId);

  if (!profile || profile.userRole !== "customer") {
    return;
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

  await sendNotification(adminClient, {
    type: "customer_registration_received",
    profileId: profile.id,
    companyId: profile.companyId,
    idempotencyKey: `registration_received:${profile.id}`,
    metadata: registrationMetadata,
  });

  await sendNotification(adminClient, {
    type: "internal_new_registration",
    profileId: profile.id,
    companyId: profile.companyId,
    idempotencyKey: `internal_registration:${profile.id}`,
    metadata: registrationMetadata,
  });
}

export async function notifyCustomerRegistrationSafe(
  adminClient: SupabaseClient,
  profileId: string
) {
  try {
    await notifyCustomerRegistration(adminClient, profileId);
  } catch (error) {
    logNotificationFailure("customer_registration", error);
  }
}

export async function notifyCustomerAccountApproved(
  adminClient: SupabaseClient,
  profileId: string
) {
  const profile = await loadProfileNotificationContext(adminClient, profileId);

  if (!profile || profile.userRole !== "customer") {
    return;
  }

  await sendNotification(adminClient, {
    type: "customer_account_approved",
    profileId: profile.id,
    companyId: profile.companyId,
    idempotencyKey: `account_approved:${profile.id}`,
    metadata: {
      customerName: profile.fullName ?? profile.firstName ?? "there",
      firstName: profile.firstName ?? "there",
      companyName: profile.companyName ?? profile.requestedCompanyName ?? "Your company",
      email: profile.email,
    },
  });
}

export async function notifyCustomerAccountApprovedSafe(
  adminClient: SupabaseClient,
  profileId: string
) {
  try {
    await notifyCustomerAccountApproved(adminClient, profileId);
  } catch (error) {
    logNotificationFailure("customer_account_approved", error);
  }
}

export async function notifyQuoteReady(
  adminClient: SupabaseClient,
  input: { quoteId: string; contactId?: string | null; versionId?: string | null }
) {
  const { data: quote, error } = await adminClient
    .from("quotes")
    .select(
      "id, company_id, contact_id, project_name, quote_number, companies(company_name), contacts(full_name, email)"
    )
    .eq("id", input.quoteId)
    .maybeSingle();

  if (error || !quote) {
    throw error ?? new Error("Quote not found.");
  }

  let versionQuery = adminClient
    .from("quote_versions")
    .select("id, version_number, total, version_status")
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
    return;
  }

  const company = extractSingle(quote.companies);
  const contact = extractSingle(quote.contacts);

  await sendNotification(adminClient, {
    type: "quote_ready",
    companyId: quote.company_id as string,
    contactId: (input.contactId ?? quote.contact_id) as string | null,
    quoteId: quote.id as string,
    idempotencyKey: `quote_ready:${quote.id}:${version.id}`,
    metadata: {
      projectName: quote.project_name,
      companyName: company?.company_name ?? "Your company",
      customerName: contact?.full_name ?? "there",
      quoteReference: formatQuoteReference(quote.quote_number),
      quoteTotal: formatMoney(version.total),
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
    await notifyQuoteReady(adminClient, input);
  } catch (error) {
    logNotificationFailure("quote_ready", error);
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
        "id, project_name, quote_number, total, required_date, fulfilment_method, companies(company_name), contacts(full_name, email)"
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
    return;
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
    nextStep,
  };

  await sendNotification(adminClient, {
    type: "quote_accepted_customer",
    companyId: input.companyId,
    contactId: input.contactId ?? null,
    quoteId: input.quoteId,
    jobId: input.jobId,
    idempotencyKey: `quote_accepted_customer:${input.quoteId}`,
    metadata: {
      ...sharedMetadata,
      jobUrl: `/jobs/${job.id}`,
    },
  });

  await sendNotification(adminClient, {
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
  });
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
    await notifyQuoteAccepted(adminClient, input);
  } catch (error) {
    logNotificationFailure("quote_accepted", error);
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

export async function notifyNewQuoteRequest(
  adminClient: SupabaseClient,
  input: { quoteRequestId: string; companyId: string; contactId: string }
) {
  const { data: quoteRequest, error } = await adminClient
    .from("quote_requests")
    .select(
      "id, project_name, required_date, fulfilment_method, companies(company_name), contacts(full_name)"
    )
    .eq("id", input.quoteRequestId)
    .maybeSingle();

  if (error || !quoteRequest) {
    throw error ?? new Error("Quote request not found.");
  }

  const company = extractSingle(quoteRequest.companies);
  const contact = extractSingle(quoteRequest.contacts);

  await sendNotification(adminClient, {
    type: "new_quote_request",
    companyId: input.companyId,
    contactId: input.contactId,
    quoteRequestId: input.quoteRequestId,
    idempotencyKey: `new_quote_request:${input.quoteRequestId}`,
    metadata: {
      projectName: quoteRequest.project_name,
      companyName: company?.company_name ?? "Customer",
      customerName: contact?.full_name ?? "Customer",
      requiredDate: quoteRequest.required_date ?? "Not specified",
      fulfilmentMethod: quoteRequest.fulfilment_method ?? "Not specified",
      quoteRequestId: quoteRequest.id,
      quoteRequestUrl: `/admin/quote-requests/${quoteRequest.id}`,
    },
  });
}

export async function notifyNewQuoteRequestSafe(
  adminClient: SupabaseClient,
  input: { quoteRequestId: string; companyId: string; contactId: string }
) {
  try {
    await notifyNewQuoteRequest(adminClient, input);
  } catch (error) {
    logNotificationFailure("new_quote_request", error);
  }
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
