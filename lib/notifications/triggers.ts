import type { SupabaseClient } from "@supabase/supabase-js";

import { sendNotification } from "@/lib/notifications/send-notification";
import { buildAbsoluteUrl } from "@/lib/notifications/templates";

function logNotificationFailure(event: string, error: unknown) {
  if (process.env.NODE_ENV === "development") {
    console.error(`[notifications] ${event}`, {
      message: error instanceof Error ? error.message : String(error),
    });
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

  const company = extractSingle(quote.companies);
  const contact = extractSingle(quote.contacts);
  const versionSuffix = input.versionId ?? "latest";

  await sendNotification(adminClient, {
    type: "quote_ready",
    companyId: quote.company_id as string,
    contactId: (input.contactId ?? quote.contact_id) as string | null,
    quoteId: quote.id as string,
    idempotencyKey: `quote_ready:${quote.id}:${versionSuffix}`,
    metadata: {
      projectName: quote.project_name,
      companyName: company?.company_name ?? "Your company",
      customerName: contact?.full_name ?? "there",
      quoteReference: formatQuoteReference(quote.quote_number),
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
        "id, project_name, quote_number, total, required_date, companies(company_name), contacts(full_name, email)"
      )
      .eq("id", input.quoteId)
      .maybeSingle(),
    adminClient
      .from("jobs")
      .select("id, job_reference, artwork_required, artwork_status")
      .eq("id", input.jobId)
      .maybeSingle(),
  ]);

  if (!quote || !job) {
    return;
  }

  const company = extractSingle(quote.companies);
  const contact = extractSingle(quote.contacts);

  const customerMetadata = {
    projectName: quote.project_name,
    companyName: company?.company_name ?? "Your company",
    customerName: contact?.full_name ?? "there",
    jobReference: job.job_reference,
    jobId: job.id,
    jobUrl: `/jobs/${job.id}`,
    nextStep: job.artwork_required
      ? "Please upload your artwork when you're ready."
      : "We'll keep you updated as production progresses.",
  };

  await sendNotification(adminClient, {
    type: "quote_accepted_confirmation",
    companyId: input.companyId,
    contactId: input.contactId ?? null,
    quoteId: input.quoteId,
    jobId: input.jobId,
    idempotencyKey: `quote_accepted:${input.quoteId}`,
    metadata: customerMetadata,
  });

  await sendNotification(adminClient, {
    type: "quote_accepted",
    companyId: input.companyId,
    contactId: input.contactId ?? null,
    quoteId: input.quoteId,
    jobId: input.jobId,
    opportunityId: input.opportunityId ?? null,
    idempotencyKey: `quote_accepted_internal:${input.quoteId}`,
    metadata: {
      ...customerMetadata,
      acceptedValue: formatMoney(quote.total),
      requiredDate: quote.required_date ?? "Not specified",
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

export { buildAbsoluteUrl };
