import type { SupabaseClient } from "@supabase/supabase-js";

import { createCrmActivity } from "@/lib/crm/create-crm-activity";
import {
  INVOICE_ACTIVITY_TYPES,
  INVOICE_DRAFT_SELECT,
  INVOICE_ITEM_SELECT,
  NON_INVOICE_BILLING_STATUSES,
  UNPRICED_BILLING_STATUSES,
} from "@/lib/invoice/constants";
import type { InvoiceDraftStatus, PricingSource } from "@/lib/invoice/constants";
import type {
  InvoiceDraftRecord,
  InvoiceItemRecord,
  InvoiceItemUpdateInput,
  InvoiceReviewData,
  XeroPayloadPreview,
} from "@/lib/invoice/types";
import { MANIFEST_ITEM_SELECT } from "@/lib/manifest/constants";
import type { ManifestItemRecord } from "@/lib/manifest/types";
import { ProductionError, isMissingProductionSchemaError } from "@/lib/production/errors";

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function calculateLineTotal(quantity: number, unitPrice: number | null) {
  if (unitPrice === null) {
    return 0;
  }

  return roundMoney(quantity * unitPrice);
}

function calculateDraftTotals(items: InvoiceItemRecord[]) {
  const billableItems = items.filter(
    (item) =>
      !item.deleted_at &&
      !NON_INVOICE_BILLING_STATUSES.includes(
        item.billing_status as (typeof NON_INVOICE_BILLING_STATUSES)[number]
      )
  );

  const subtotal = roundMoney(
    billableItems.reduce((sum, item) => sum + item.line_total, 0)
  );
  const taxTotal = roundMoney(
    billableItems.reduce(
      (sum, item) => sum + item.line_total * (item.tax_rate / 100),
      0
    )
  );

  return {
    subtotal,
    tax_total: taxTotal,
    total: roundMoney(subtotal + taxTotal),
  };
}

function shouldIncludeInInvoice(manifestItem: ManifestItemRecord) {
  return !NON_INVOICE_BILLING_STATUSES.includes(
    manifestItem.billing_status as (typeof NON_INVOICE_BILLING_STATUSES)[number]
  );
}

function defaultPricingForManifestItem(item: ManifestItemRecord) {
  if (
    item.billing_status === "reprint_no_charge" ||
    item.billing_status === "no_charge"
  ) {
    return {
      unit_price: 0,
      line_total: 0,
      pricing_source: "no_charge" as PricingSource,
      billing_status: item.billing_status,
    };
  }

  if (item.source_type === "quoted" && item.quote_unit_price !== null) {
    const quantity = item.quantity ?? item.quoted_quantity ?? 1;
    const unitPrice = item.quote_unit_price;
    return {
      unit_price: unitPrice,
      line_total: calculateLineTotal(quantity, unitPrice),
      pricing_source: "accepted_quote" as PricingSource,
      billing_status:
        item.billing_status === "price_required"
          ? ("ready_to_invoice" as const)
          : item.billing_status,
    };
  }

  return {
    unit_price: null,
    line_total: 0,
    pricing_source: "manual" as PricingSource,
    billing_status: "price_required" as const,
  };
}

async function logInvoiceActivity(
  adminClient: SupabaseClient,
  input: {
    activityType: string;
    description: string;
    companyId: string;
    quoteId: string | null;
    jobId: string;
    invoiceDraftId: string;
    actorProfileId?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  if (!input.quoteId) {
    return;
  }

  await createCrmActivity(adminClient, {
    companyId: input.companyId,
    quoteId: input.quoteId,
    activityType: input.activityType,
    description: input.description,
    actorProfileId: input.actorProfileId ?? null,
    metadata: {
      ...input.metadata,
      job_id: input.jobId,
      invoice_draft_id: input.invoiceDraftId,
      internal_only: true,
    },
    validatedLinks: {
      companyId: input.companyId,
      contactId: null,
      opportunityId: null,
      quoteId: input.quoteId,
      taskId: null,
    },
  });
}

async function loadJobInvoiceContext(adminClient: SupabaseClient, jobId: string) {
  const { data: job, error } = await adminClient
    .from("jobs")
    .select(
      "id, company_id, quote_id, job_reference, commercial_status, project_name"
    )
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw new ProductionError(error.message, 500);
  }

  if (!job) {
    throw new ProductionError("Job not found.", 404);
  }

  return job as {
    id: string;
    company_id: string;
    quote_id: string;
    job_reference: string;
    commercial_status: string;
    project_name: string;
  };
}

async function getOrCreateInvoiceDraft(
  adminClient: SupabaseClient,
  jobId: string,
  actorProfileId?: string | null
) {
  const job = await loadJobInvoiceContext(adminClient, jobId);

  const { data: existingDraft, error: existingError } = await adminClient
    .from("job_invoice_drafts")
    .select(INVOICE_DRAFT_SELECT)
    .eq("job_id", jobId)
    .not("status", "in", '("cancelled","invoiced")')
    .maybeSingle();

  if (existingError) {
    if (isMissingProductionSchemaError(existingError)) {
      return { draft: null, schemaMissing: true as const, job };
    }

    throw new ProductionError(existingError.message, 500);
  }

  if (existingDraft) {
    return {
      draft: existingDraft as InvoiceDraftRecord,
      schemaMissing: false as const,
      job,
    };
  }

  const { data: draft, error: insertError } = await adminClient
    .from("job_invoice_drafts")
    .insert({
      job_id: jobId,
      company_id: job.company_id,
      quote_id: job.quote_id,
      status: "draft",
    })
    .select(INVOICE_DRAFT_SELECT)
    .single();

  if (insertError || !draft) {
    throw new ProductionError(
      insertError?.message ?? "Unable to create invoice draft.",
      500
    );
  }

  await logInvoiceActivity(adminClient, {
    activityType: INVOICE_ACTIVITY_TYPES.invoiceDraftCreated,
    description: `Invoice draft created for ${job.job_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    jobId: job.id,
    invoiceDraftId: draft.id,
    actorProfileId,
  });

  return {
    draft: draft as InvoiceDraftRecord,
    schemaMissing: false as const,
    job,
  };
}

export async function reconcileInvoiceDraft(
  adminClient: SupabaseClient,
  jobId: string,
  actorProfileId?: string | null
) {
  const { draft, schemaMissing, job } = await getOrCreateInvoiceDraft(
    adminClient,
    jobId,
    actorProfileId
  );

  if (schemaMissing || !draft) {
    return { draft: null, schemaMissing, error: "Invoice tables not configured." };
  }

  const { data: manifestItems, error: manifestError } = await adminClient
    .from("production_items")
    .select(MANIFEST_ITEM_SELECT)
    .eq("job_id", jobId)
    .is("deleted_at", null);

  if (manifestError) {
    throw new ProductionError(manifestError.message, 500);
  }

  const items = (manifestItems ?? []) as ManifestItemRecord[];

  const { data: existingLines, error: linesError } = await adminClient
    .from("job_invoice_items")
    .select(INVOICE_ITEM_SELECT)
    .eq("invoice_draft_id", draft.id)
    .is("deleted_at", null);

  if (linesError) {
    throw new ProductionError(linesError.message, 500);
  }

  const existingByProductionItemId = new Map(
    (existingLines ?? [])
      .filter((line) => line.production_item_id)
      .map((line) => [line.production_item_id as string, line])
  );

  for (const manifestItem of items) {
    if (!shouldIncludeInInvoice(manifestItem)) {
      continue;
    }

    if (existingByProductionItemId.has(manifestItem.id)) {
      continue;
    }

    const pricing = defaultPricingForManifestItem(manifestItem);
    const quantity = manifestItem.quantity ?? manifestItem.quoted_quantity ?? 1;

    await adminClient.from("job_invoice_items").insert({
      invoice_draft_id: draft.id,
      job_id: jobId,
      production_item_id: manifestItem.id,
      quote_item_id: manifestItem.quote_item_id,
      description: manifestItem.item_name,
      quantity,
      unit: manifestItem.unit ?? "each",
      unit_price: pricing.unit_price,
      line_total: pricing.line_total,
      tax_rate: 20,
      billing_status: pricing.billing_status,
      pricing_source: pricing.pricing_source,
      pricing_note: manifestItem.internal_note,
    });
  }

  const { data: refreshedLines, error: refreshError } = await adminClient
    .from("job_invoice_items")
    .select(INVOICE_ITEM_SELECT)
    .eq("invoice_draft_id", draft.id)
    .is("deleted_at", null);

  if (refreshError) {
    throw new ProductionError(refreshError.message, 500);
  }

  const invoiceItems = (refreshedLines ?? []) as InvoiceItemRecord[];
  const totals = calculateDraftTotals(invoiceItems);
  const unpricedCount = invoiceItems.filter((item) =>
    UNPRICED_BILLING_STATUSES.includes(
      item.billing_status as (typeof UNPRICED_BILLING_STATUSES)[number]
    )
  ).length;

  const nextStatus: InvoiceDraftStatus =
    unpricedCount > 0 ? "needs_pricing" : "ready_for_review";

  const { data: updatedDraft, error: updateError } = await adminClient
    .from("job_invoice_drafts")
    .update({
      ...totals,
      status: draft.status === "approved" ? draft.status : nextStatus,
    })
    .eq("id", draft.id)
    .select(INVOICE_DRAFT_SELECT)
    .single();

  if (updateError || !updatedDraft) {
    throw new ProductionError(updateError?.message ?? "Unable to update draft.", 500);
  }

  if (job.commercial_status === "not_ready") {
    await adminClient
      .from("jobs")
      .update({ commercial_status: "invoice_review" })
      .eq("id", jobId);
  }

  await logInvoiceActivity(adminClient, {
    activityType: INVOICE_ACTIVITY_TYPES.invoiceDraftReconciled,
    description: `Invoice draft reconciled for ${job.job_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    jobId: job.id,
    invoiceDraftId: draft.id,
    actorProfileId,
    metadata: { unpriced_count: unpricedCount, line_count: invoiceItems.length },
  });

  return {
    draft: updatedDraft as InvoiceDraftRecord,
    schemaMissing: false as const,
    error: null,
  };
}

export async function loadInvoiceReviewData(
  adminClient: SupabaseClient,
  jobId: string,
  actorProfileId?: string | null
): Promise<InvoiceReviewData> {
  const reconcileResult = await reconcileInvoiceDraft(
    adminClient,
    jobId,
    actorProfileId
  );

  if (reconcileResult.schemaMissing || !reconcileResult.draft) {
    return {
      draft: null as unknown as InvoiceDraftRecord,
      invoiceItems: [],
      manifestItems: [],
      quotedItems: [],
      productionChanges: [],
      finalLines: [],
      unpricedCount: 0,
      canApprove: false,
      schemaMissing: reconcileResult.schemaMissing,
      error: reconcileResult.error ?? "Unable to load invoice draft.",
    };
  }

  const draft = reconcileResult.draft;

  const [{ data: manifestItems }, { data: invoiceItems }] = await Promise.all([
    adminClient
      .from("production_items")
      .select(MANIFEST_ITEM_SELECT)
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    adminClient
      .from("job_invoice_items")
      .select(INVOICE_ITEM_SELECT)
      .eq("invoice_draft_id", draft.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
  ]);

  const typedManifest = (manifestItems ?? []) as ManifestItemRecord[];
  const typedInvoiceItems = (invoiceItems ?? []) as InvoiceItemRecord[];

  const quotedItems = typedManifest.filter(
    (item) =>
      item.source_type === "quoted" &&
      item.production_requirement_status !== "cancelled" &&
      item.billing_status !== "cancelled"
  );
  const productionChanges = typedManifest.filter(
    (item) =>
      item.source_type !== "quoted" ||
      item.billing_status === "cancelled" ||
      item.production_requirement_status === "cancelled" ||
      item.billing_status === "reprint_no_charge" ||
      item.billing_status === "no_charge"
  );
  const finalLines = typedInvoiceItems.filter(
    (item) =>
      !NON_INVOICE_BILLING_STATUSES.includes(
        item.billing_status as (typeof NON_INVOICE_BILLING_STATUSES)[number]
      )
  );

  const unpricedCount = finalLines.filter((item) =>
    UNPRICED_BILLING_STATUSES.includes(
      item.billing_status as (typeof UNPRICED_BILLING_STATUSES)[number]
    )
  ).length;

  return {
    draft,
    invoiceItems: typedInvoiceItems,
    manifestItems: typedManifest,
    quotedItems,
    productionChanges,
    finalLines,
    unpricedCount,
    canApprove: unpricedCount === 0 && finalLines.length > 0,
    schemaMissing: false,
    error: null,
  };
}

export async function updateInvoiceItem(
  adminClient: SupabaseClient,
  itemId: string,
  input: InvoiceItemUpdateInput,
  actorProfileId: string
) {
  const { data: existing, error: loadError } = await adminClient
    .from("job_invoice_items")
    .select(INVOICE_ITEM_SELECT)
    .eq("id", itemId)
    .is("deleted_at", null)
    .maybeSingle();

  if (loadError) {
    throw new ProductionError(loadError.message, 500);
  }

  if (!existing) {
    throw new ProductionError("Invoice line not found.", 404);
  }

  const quantity = input.quantity ?? existing.quantity;
  const unitPrice =
    input.unitPrice !== undefined ? input.unitPrice : existing.unit_price;
  const billingStatus = input.billingStatus ?? existing.billing_status;
  const lineTotal =
    billingStatus === "price_required" || unitPrice === null
      ? 0
      : calculateLineTotal(quantity, unitPrice);

  const { data: item, error } = await adminClient
    .from("job_invoice_items")
    .update({
      description: input.description?.trim() ?? existing.description,
      quantity,
      unit: input.unit ?? existing.unit,
      unit_price: unitPrice,
      line_total: lineTotal,
      tax_rate: input.taxRate ?? existing.tax_rate,
      billing_status:
        unitPrice !== null && billingStatus === "price_required"
          ? "ready_to_invoice"
          : billingStatus,
      pricing_source: input.pricingSource ?? existing.pricing_source,
      pricing_note: input.pricingNote ?? existing.pricing_note,
    })
    .eq("id", itemId)
    .select(INVOICE_ITEM_SELECT)
    .single();

  if (error || !item) {
    throw new ProductionError(error?.message ?? "Unable to update invoice line.", 500);
  }

  const { data: allLines } = await adminClient
    .from("job_invoice_items")
    .select(INVOICE_ITEM_SELECT)
    .eq("invoice_draft_id", existing.invoice_draft_id)
    .is("deleted_at", null);

  const totals = calculateDraftTotals((allLines ?? []) as InvoiceItemRecord[]);
  const unpricedCount = ((allLines ?? []) as InvoiceItemRecord[]).filter((line) =>
    UNPRICED_BILLING_STATUSES.includes(
      line.billing_status as (typeof UNPRICED_BILLING_STATUSES)[number]
    )
  ).length;

  await adminClient
    .from("job_invoice_drafts")
    .update({
      ...totals,
      status: unpricedCount > 0 ? "needs_pricing" : "ready_for_review",
    })
    .eq("id", existing.invoice_draft_id);

  const job = await loadJobInvoiceContext(adminClient, existing.job_id);

  await logInvoiceActivity(adminClient, {
    activityType: INVOICE_ACTIVITY_TYPES.invoiceItemPriced,
    description: `Invoice line priced for ${job.job_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    jobId: job.id,
    invoiceDraftId: existing.invoice_draft_id,
    actorProfileId,
    metadata: { invoice_item_id: itemId, unit_price: unitPrice },
  });

  return item as InvoiceItemRecord;
}

export async function approveInvoiceDraft(
  adminClient: SupabaseClient,
  draftId: string,
  actorProfileId: string
) {
  const { data: draft, error: draftError } = await adminClient
    .from("job_invoice_drafts")
    .select(INVOICE_DRAFT_SELECT)
    .eq("id", draftId)
    .maybeSingle();

  if (draftError) {
    throw new ProductionError(draftError.message, 500);
  }

  if (!draft) {
    throw new ProductionError("Invoice draft not found.", 404);
  }

  const { data: lines, error: linesError } = await adminClient
    .from("job_invoice_items")
    .select(INVOICE_ITEM_SELECT)
    .eq("invoice_draft_id", draftId)
    .is("deleted_at", null);

  if (linesError) {
    throw new ProductionError(linesError.message, 500);
  }

  const invoiceItems = (lines ?? []) as InvoiceItemRecord[];
  const unpricedCount = invoiceItems.filter(
    (item) =>
      !NON_INVOICE_BILLING_STATUSES.includes(
        item.billing_status as (typeof NON_INVOICE_BILLING_STATUSES)[number]
      ) &&
      UNPRICED_BILLING_STATUSES.includes(
        item.billing_status as (typeof UNPRICED_BILLING_STATUSES)[number]
      )
  ).length;

  if (unpricedCount > 0) {
    throw new ProductionError(
      "Cannot approve invoice draft while billable items still require pricing.",
      400
    );
  }

  const now = new Date().toISOString();

  const { data: approvedDraft, error: approveError } = await adminClient
    .from("job_invoice_drafts")
    .update({
      status: "approved",
      approved_by: actorProfileId,
      approved_at: now,
    })
    .eq("id", draftId)
    .select(INVOICE_DRAFT_SELECT)
    .single();

  if (approveError || !approvedDraft) {
    throw new ProductionError(
      approveError?.message ?? "Unable to approve invoice draft.",
      500
    );
  }

  const job = await loadJobInvoiceContext(adminClient, draft.job_id);

  await adminClient
    .from("jobs")
    .update({ commercial_status: "ready_for_xero" })
    .eq("id", draft.job_id);

  await logInvoiceActivity(adminClient, {
    activityType: INVOICE_ACTIVITY_TYPES.invoiceDraftApproved,
    description: `Invoice draft approved for ${job.job_reference}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    jobId: job.id,
    invoiceDraftId: draftId,
    actorProfileId,
  });

  return approvedDraft as InvoiceDraftRecord;
}

export function buildXeroPayloadPreview(input: {
  companyName: string;
  jobReference: string;
  quoteReference: string | null;
  purchaseOrderNumber: string | null;
  currency: string;
  invoiceItems: InvoiceItemRecord[];
  subtotal: number;
  taxTotal: number;
  total: number;
}): XeroPayloadPreview {
  const today = new Date();
  const due = new Date(today);
  due.setDate(due.getDate() + 30);

  const billableLines = input.invoiceItems.filter(
    (item) =>
      !item.deleted_at &&
      !NON_INVOICE_BILLING_STATUSES.includes(
        item.billing_status as (typeof NON_INVOICE_BILLING_STATUSES)[number]
      )
  );

  return {
    contactName: input.companyName,
    jobReference: input.jobReference,
    quoteReference: input.quoteReference,
    purchaseOrderNumber: input.purchaseOrderNumber,
    invoiceDate: today.toISOString().slice(0, 10),
    dueDate: due.toISOString().slice(0, 10),
    currency: input.currency,
    lineItems: billableLines.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitAmount: item.unit_price ?? 0,
      taxRate: item.tax_rate,
      lineTotal: item.line_total,
    })),
    subtotal: input.subtotal,
    taxTotal: input.taxTotal,
    total: input.total,
  };
}
