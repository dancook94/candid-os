import type { SupabaseClient } from "@supabase/supabase-js";

import { createCrmActivity } from "@/lib/crm/create-crm-activity";
import {
  INVOICE_ACTIVITY_TYPES,
  INVOICE_DRAFT_SELECT,
  INVOICE_ITEM_SELECT,
  NON_INVOICE_BILLING_STATUSES,
} from "@/lib/invoice/constants";
import type { InvoiceDraftStatus, PricingSource } from "@/lib/invoice/constants";
import type {
  InvoiceDraftRecord,
  InvoiceItemRecord,
  InvoiceItemUpdateInput,
  InvoiceLineView,
  InvoiceReviewData,
  InvoiceTotalGroups,
  QuoteTotalAudit,
  XeroPayloadPreview,
} from "@/lib/invoice/types";
import {
  buildQuoteLineDiagnostics,
  partitionManifestItemsForReview,
  quoteVersionVatRateToPercent,
  type AcceptedQuoteLine,
} from "@/lib/invoice/quote-lines";
import { ensureProductionManifestForJob, loadAcceptedQuoteItems } from "@/lib/manifest/service";
import { MANIFEST_ITEM_SELECT } from "@/lib/manifest/constants";
import type { ManifestItemRecord } from "@/lib/manifest/types";
import {
  calculateInvoiceTotalGroups,
  calculateQuoteTotalAudit,
  findMissingQuotedInvoiceLines,
  shouldIncludeManifestItemInInvoice,
} from "@/lib/invoice/total-groups";
import {
  buildInvoiceLineFromManifestItem,
  buildXeroLineDescription,
  getInvoiceLineSourceLabel,
  isManualPricingSource,
} from "@/lib/invoice/line-text";
import { deriveInvoiceDisplayStatus } from "@/lib/invoice/display-status";
import {
  buildInvoiceApprovalReadiness,
  getBillableInvoiceLines,
} from "@/lib/invoice/validation";
import {
  calculateInvoiceDraftTotals,
  calculatePersistedLineNetTotal,
  invoiceLineNeedsPricing,
  normalizeInvoiceItemNumericFields,
  parseMoneyValue,
  parseQuantityValue,
  resolveBillingStatusAfterPricing,
  roundMoney,
} from "@/lib/invoice/money";
import { ProductionError, isMissingInvoiceSchemaError, isMissingProductionSchemaError } from "@/lib/production/errors";

async function repairInvoiceLineTotals(
  adminClient: SupabaseClient,
  items: InvoiceItemRecord[]
) {
  const repaired: InvoiceItemRecord[] = [];

  for (const rawItem of items) {
    const normalized = normalizeInvoiceItemNumericFields(rawItem);
    const needsRepair =
      normalized.quantity !== parseQuantityValue(rawItem.quantity) ||
      normalized.unit_price !== parseMoneyValue(rawItem.unit_price) ||
      normalized.tax_rate !== (parseMoneyValue(rawItem.tax_rate) ?? 0) ||
      normalized.line_total !== parseMoneyValue(rawItem.line_total) ||
      normalized.billing_status !== rawItem.billing_status;

    if (!needsRepair) {
      repaired.push(normalized);
      continue;
    }

    const { data: updated, error } = await adminClient
      .from("job_invoice_items")
      .update({
        quantity: normalized.quantity,
        unit_price: normalized.unit_price,
        tax_rate: normalized.tax_rate,
        line_total: normalized.line_total,
        billing_status: normalized.billing_status,
      })
      .eq("id", rawItem.id)
      .select(INVOICE_ITEM_SELECT)
      .single();

    if (error || !updated) {
      throw new ProductionError(error?.message ?? "Unable to repair invoice line.", 500);
    }

    repaired.push(normalizeInvoiceItemNumericFields(updated as InvoiceItemRecord));
  }

  return repaired;
}

function detectProductionChangedAfterApproval(input: {
  draft: InvoiceDraftRecord;
  manifestItems: ManifestItemRecord[];
  invoiceItems: InvoiceItemRecord[];
}) {
  if (input.draft.status !== "approved" || !input.draft.approved_at) {
    return false;
  }

  const approvedAt = new Date(input.draft.approved_at).getTime();
  const manifestById = new Map(input.manifestItems.map((item) => [item.id, item]));
  const activeInvoiceLines = input.invoiceItems.filter((line) => !line.deleted_at);
  const invoiceProductionIds = new Set(
    activeInvoiceLines
      .map((line) => line.production_item_id)
      .filter((id): id is string => Boolean(id))
  );

  if (
    input.manifestItems.some(
      (item) => new Date(item.updated_at).getTime() > approvedAt
    )
  ) {
    return true;
  }

  const billableManifestItems = input.manifestItems.filter(shouldIncludeInInvoice);
  if (billableManifestItems.some((item) => !invoiceProductionIds.has(item.id))) {
    return true;
  }

  return activeInvoiceLines.some((line) => {
    if (!line.production_item_id) {
      return false;
    }

    const manifestItem = manifestById.get(line.production_item_id);
    return !manifestItem || !shouldIncludeInInvoice(manifestItem);
  });
}

async function refreshDraftTotalsAndStatus(
  adminClient: SupabaseClient,
  draftId: string,
  preserveApproved = false
) {
  const { data: draft, error: draftError } = await adminClient
    .from("job_invoice_drafts")
    .select(INVOICE_DRAFT_SELECT)
    .eq("id", draftId)
    .maybeSingle();

  if (draftError || !draft) {
    throw new ProductionError(draftError?.message ?? "Invoice draft not found.", 500);
  }

  const { data: lines, error: linesError } = await adminClient
    .from("job_invoice_items")
    .select(INVOICE_ITEM_SELECT)
    .eq("invoice_draft_id", draftId)
    .is("deleted_at", null);

  if (linesError) {
    throw new ProductionError(linesError.message, 500);
  }

  const rawItems = (lines ?? []) as InvoiceItemRecord[];
  const invoiceItems = await repairInvoiceLineTotals(adminClient, rawItems);
  const totals = calculateInvoiceDraftTotals(invoiceItems);
  const unpricedCount = getBillableInvoiceLines(invoiceItems).filter(invoiceLineNeedsPricing)
    .length;

  const typedDraft = draft as InvoiceDraftRecord;
  let nextStatus: InvoiceDraftStatus = typedDraft.status;

  if (!preserveApproved || typedDraft.status !== "approved") {
    if (
      typedDraft.status === "pushed_to_xero" ||
      typedDraft.status === "invoiced" ||
      typedDraft.status === "cancelled"
    ) {
      nextStatus = typedDraft.status;
    } else if (typedDraft.status === "approved") {
      nextStatus = "approved";
    } else {
      nextStatus = unpricedCount > 0 ? "needs_pricing" : "ready_for_review";
    }
  }

  const { data: updatedDraft, error: updateError } = await adminClient
    .from("job_invoice_drafts")
    .update({
      ...totals,
      status: nextStatus,
    })
    .eq("id", draftId)
    .select(INVOICE_DRAFT_SELECT)
    .single();

  if (updateError || !updatedDraft) {
    throw new ProductionError(updateError?.message ?? "Unable to update draft.", 500);
  }

  return {
    draft: updatedDraft as InvoiceDraftRecord,
    unpricedCount,
    invoiceItems,
  };
}

function shouldIncludeInInvoice(manifestItem: ManifestItemRecord) {
  return shouldIncludeManifestItemInInvoice(manifestItem);
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
    const quantity = parseQuantityValue(item.quantity ?? item.quoted_quantity ?? 1);
    const unitPrice = parseMoneyValue(item.quote_unit_price);
    return {
      unit_price: unitPrice,
      line_total: calculatePersistedLineNetTotal({
        quantity,
        unitPrice,
        billingStatus:
          item.billing_status === "price_required"
            ? "ready_to_invoice"
            : item.billing_status,
      }),
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
      "id, company_id, quote_id, quote_version_id, job_reference, commercial_status, project_name"
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
    quote_version_id: string | null;
    job_reference: string;
    commercial_status: string;
    project_name: string;
  };
}

async function loadAcceptedQuoteContext(
  adminClient: SupabaseClient,
  quoteVersionId: string | null
): Promise<{ quoteItems: AcceptedQuoteLine[]; taxRatePercent: number }> {
  if (!quoteVersionId) {
    return { quoteItems: [], taxRatePercent: 20 };
  }

  const [{ data: quoteVersion }, quoteItems] = await Promise.all([
    adminClient
      .from("quote_versions")
      .select("vat_rate")
      .eq("id", quoteVersionId)
      .maybeSingle(),
    loadAcceptedQuoteItems(adminClient, quoteVersionId),
  ]);

  return {
    quoteItems: quoteItems as AcceptedQuoteLine[],
    taxRatePercent: quoteVersionVatRateToPercent(
      (quoteVersion as { vat_rate?: number | null } | null)?.vat_rate
    ),
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
    if (isMissingProductionSchemaError(existingError) || isMissingInvoiceSchemaError(existingError)) {
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

  try {
    await ensureProductionManifestForJob(adminClient, jobId, actorProfileId);
  } catch {
    // Manifest sync is best-effort; invoice reconcile proceeds with existing items.
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
  const manifestById = new Map(items.map((item) => [item.id, item]));
  const canMutateLines = !["approved", "pushed_to_xero", "invoiced"].includes(
    draft.status
  );

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

  if (canMutateLines) {
    const now = new Date().toISOString();

    for (const line of existingLines ?? []) {
      if (!line.production_item_id) {
        continue;
      }

      const manifestItem = manifestById.get(line.production_item_id);

      if (!manifestItem || !shouldIncludeInInvoice(manifestItem)) {
        await adminClient
          .from("job_invoice_items")
          .update({ deleted_at: now })
          .eq("id", line.id);
        existingByProductionItemId.delete(line.production_item_id);
      }
    }
  }

  for (const manifestItem of items) {
    if (!shouldIncludeInInvoice(manifestItem)) {
      continue;
    }

    if (existingByProductionItemId.has(manifestItem.id)) {
      continue;
    }

    const pricing = defaultPricingForManifestItem(manifestItem);
    const quantity = manifestItem.quantity ?? manifestItem.quoted_quantity ?? 1;
    const lineText = buildInvoiceLineFromManifestItem(manifestItem);

    await adminClient.from("job_invoice_items").insert({
      invoice_draft_id: draft.id,
      job_id: jobId,
      production_item_id: manifestItem.id,
      quote_item_id: manifestItem.quote_item_id,
      item_name: lineText.item_name,
      description: lineText.description,
      quantity,
      unit: manifestItem.unit ?? "each",
      unit_price: pricing.unit_price,
      line_total: pricing.line_total,
      tax_rate: 20,
      billing_status: pricing.billing_status,
      pricing_source: pricing.pricing_source,
      pricing_note: manifestItem.internal_note,
      manually_edited: false,
    });
  }

  const refreshed = await refreshDraftTotalsAndStatus(
    adminClient,
    draft.id,
    draft.status === "approved"
  );
  const updatedDraft = refreshed.draft;
  const invoiceItems = refreshed.invoiceItems;
  const unpricedCount = refreshed.unpricedCount;

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
    draft: updatedDraft,
    schemaMissing: false as const,
    error: null,
  };
}

export async function ensureInvoiceDraftForJob(
  adminClient: SupabaseClient,
  jobId: string,
  actorProfileId?: string | null
) {
  try {
    return await reconcileInvoiceDraft(adminClient, jobId, actorProfileId);
  } catch {
    return { draft: null, schemaMissing: false, error: "Unable to ensure invoice draft." };
  }
}

export async function loadInvoiceReviewData(
  adminClient: SupabaseClient,
  jobId: string,
  actorProfileId?: string | null,
  companyName?: string | null
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
      approvalReadiness: {
        canApprove: false,
        checklist: [],
        blockingReasons: [
          reconcileResult.error ?? "Unable to load invoice draft.",
        ],
        lineIssues: [],
      },
      displayStatus: "draft",
      productionChangedAfterApproval: false,
      isApproved: false,
      totalGroups: {
        originalQuote: { subtotal: 0, tax_total: 0, total: 0 },
        productionChanges: { subtotal: 0, tax_total: 0, total: 0 },
        finalInvoice: { subtotal: 0, tax_total: 0, total: 0 },
      },
      quoteAudit: {
        beforeCancellations: { subtotal: 0, tax_total: 0, total: 0 },
        cancellations: { subtotal: 0, tax_total: 0, total: 0 },
        adjustedOriginal: { subtotal: 0, tax_total: 0, total: 0 },
      },
      quoteLineDiagnostics: null,
      schemaMissing: reconcileResult.schemaMissing,
      error: reconcileResult.error ?? "Unable to load invoice draft.",
    };
  }

  const draft = reconcileResult.draft;

  const [
    { data: manifestItems },
    { data: invoiceItems },
    { data: company },
    job,
  ] = await Promise.all([
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
    companyName
      ? Promise.resolve({ data: { company_name: companyName } })
      : adminClient
          .from("companies")
          .select("company_name")
          .eq("id", draft.company_id)
          .maybeSingle(),
    loadJobInvoiceContext(adminClient, jobId),
  ]);

  const acceptedQuoteContext = await loadAcceptedQuoteContext(
    adminClient,
    job.quote_version_id
  );

  const typedManifest = (manifestItems ?? []) as ManifestItemRecord[];
  const typedInvoiceItems = (invoiceItems ?? []).map((item) =>
    normalizeInvoiceItemNumericFields(item as InvoiceItemRecord)
  );
  const resolvedCompanyName =
    companyName ?? (company as { company_name?: string } | null)?.company_name ?? null;

  const { originallyQuoted: quotedItems, productionChanges } =
    partitionManifestItemsForReview(typedManifest);
  const manifestById = new Map(typedManifest.map((item) => [item.id, item]));

  const finalLines: InvoiceLineView[] = typedInvoiceItems
    .filter(
      (item) =>
        !NON_INVOICE_BILLING_STATUSES.includes(
          item.billing_status as (typeof NON_INVOICE_BILLING_STATUSES)[number]
        )
    )
    .map((line) => {
      const manifestItem = line.production_item_id
        ? manifestById.get(line.production_item_id) ?? null
        : null;

      return {
        ...line,
        sourceLabel: getInvoiceLineSourceLabel(line, manifestItem),
        canResetFromSource: Boolean(manifestItem),
      };
    })
    .sort((left, right) => {
      const leftManifest = left.production_item_id
        ? manifestById.get(left.production_item_id) ?? null
        : null;
      const rightManifest = right.production_item_id
        ? manifestById.get(right.production_item_id) ?? null
        : null;
      const leftIsQuote =
        leftManifest?.source_type === "quoted" ||
        left.pricing_source === "accepted_quote";
      const rightIsQuote =
        rightManifest?.source_type === "quoted" ||
        right.pricing_source === "accepted_quote";

      if (leftIsQuote !== rightIsQuote) {
        return leftIsQuote ? -1 : 1;
      }

      return left.created_at.localeCompare(right.created_at);
    });

  const unpricedCount = finalLines.filter(invoiceLineNeedsPricing).length;
  const totalGroups = calculateInvoiceTotalGroups(typedInvoiceItems, manifestById);
  const quoteAudit = calculateQuoteTotalAudit({
    quoteItems: acceptedQuoteContext.quoteItems,
    manifestItems: typedManifest,
    taxRatePercent: acceptedQuoteContext.taxRatePercent,
  });
  const quoteLineDiagnostics =
    process.env.NODE_ENV === "development"
      ? buildQuoteLineDiagnostics({
          quoteItems: acceptedQuoteContext.quoteItems,
          manifestItems: typedManifest,
          invoiceItems: typedInvoiceItems,
          taxRatePercent: acceptedQuoteContext.taxRatePercent,
        })
      : null;

  const approvalReadiness = buildInvoiceApprovalReadiness({
    draft,
    invoiceItems: typedInvoiceItems,
    quoteItems: acceptedQuoteContext.quoteItems,
    manifestItems: typedManifest,
    companyName: resolvedCompanyName,
    quoteLinked: Boolean(draft.quote_id),
  });

  const displayStatus = deriveInvoiceDisplayStatus({
    status: draft.status,
    unpricedCount,
  });

  const productionChangedAfterApproval = detectProductionChangedAfterApproval({
    draft,
    manifestItems: typedManifest,
    invoiceItems: typedInvoiceItems,
  });

  return {
    draft,
    invoiceItems: typedInvoiceItems,
    manifestItems: typedManifest,
    quotedItems,
    productionChanges,
    finalLines,
    unpricedCount,
    canApprove: approvalReadiness.canApprove,
    approvalReadiness,
    displayStatus,
    productionChangedAfterApproval,
    isApproved: draft.status === "approved",
    totalGroups,
    quoteAudit,
    quoteLineDiagnostics,
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

  const { data: parentDraft, error: draftError } = await adminClient
    .from("job_invoice_drafts")
    .select("status")
    .eq("id", existing.invoice_draft_id)
    .maybeSingle();

  if (draftError) {
    throw new ProductionError(draftError.message, 500);
  }

  if (parentDraft?.status === "approved") {
    throw new ProductionError(
      "Production changed after invoice approval. Reopen the draft before editing commercial lines.",
      409
    );
  }

  const quantity = input.quantity !== undefined
    ? parseQuantityValue(input.quantity)
    : parseQuantityValue(existing.quantity);
  const unitPrice =
    input.unitPrice !== undefined
      ? parseMoneyValue(input.unitPrice)
      : parseMoneyValue(existing.unit_price);
  const taxRate =
    input.taxRate !== undefined
      ? parseMoneyValue(input.taxRate) ?? 0
      : parseMoneyValue(existing.tax_rate) ?? 0;

  if (input.quantity !== undefined && quantity <= 0) {
    throw new ProductionError("Quantity must be greater than zero.", 400);
  }

  if (input.unitPrice !== undefined && input.unitPrice !== null && unitPrice === null) {
    throw new ProductionError("Unit price must be a valid number.", 400);
  }

  if (input.taxRate !== undefined && taxRate < 0) {
    throw new ProductionError("VAT rate cannot be negative.", 400);
  }

  const billingStatus = resolveBillingStatusAfterPricing(
    input.billingStatus ?? existing.billing_status,
    unitPrice
  );
  const itemName = input.itemName?.trim() ?? existing.item_name;
  const description =
    input.description !== undefined ? input.description : existing.description;
  const lineTotal = calculatePersistedLineNetTotal({
    quantity,
    unitPrice,
    billingStatus,
  });

  const textChanged =
    itemName !== existing.item_name ||
    (description ?? "") !== (existing.description ?? "");
  const priceChanged =
    input.unitPrice !== undefined &&
    unitPrice !== parseMoneyValue(existing.unit_price);
  const manuallyEdited =
    input.manuallyEdited ??
    (existing.manually_edited || textChanged || priceChanged);

  const pricingSource =
    priceChanged || isManualPricingSource(existing.pricing_source)
      ? input.pricingSource ??
        (priceChanged ? ("manual" as PricingSource) : existing.pricing_source)
      : input.pricingSource ?? existing.pricing_source;

  const { data: item, error } = await adminClient
    .from("job_invoice_items")
    .update({
      item_name: itemName,
      description,
      quantity,
      unit: input.unit ?? existing.unit,
      unit_price: unitPrice,
      line_total: lineTotal,
      tax_rate: taxRate,
      billing_status: billingStatus,
      pricing_source: pricingSource,
      pricing_note: input.pricingNote ?? existing.pricing_note,
      manually_edited: manuallyEdited,
    })
    .eq("id", itemId)
    .select(INVOICE_ITEM_SELECT)
    .single();

  if (error || !item) {
    throw new ProductionError(error?.message ?? "Unable to update invoice line.", 500);
  }

  await refreshDraftTotalsAndStatus(adminClient, existing.invoice_draft_id);

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

export async function resetInvoiceItemFromSource(
  adminClient: SupabaseClient,
  itemId: string,
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

  if (!existing.production_item_id) {
    throw new ProductionError("This invoice line has no linked production item.", 400);
  }

  const { data: manifestItem, error: manifestError } = await adminClient
    .from("production_items")
    .select(MANIFEST_ITEM_SELECT)
    .eq("id", existing.production_item_id)
    .maybeSingle();

  if (manifestError) {
    throw new ProductionError(manifestError.message, 500);
  }

  if (!manifestItem) {
    throw new ProductionError("Linked production item not found.", 404);
  }

  const typedManifest = manifestItem as ManifestItemRecord;
  const lineText = buildInvoiceLineFromManifestItem(typedManifest);
  const pricing = defaultPricingForManifestItem(typedManifest);
  const quantity = typedManifest.quantity ?? typedManifest.quoted_quantity ?? 1;

  return updateInvoiceItem(
    adminClient,
    itemId,
    {
      itemName: lineText.item_name,
      description: lineText.description,
      quantity,
      unit: typedManifest.unit ?? "each",
      unitPrice: pricing.unit_price,
      billingStatus: pricing.billing_status,
      pricingSource: pricing.pricing_source,
      pricingNote: typedManifest.internal_note,
      manuallyEdited: false,
    },
    actorProfileId
  );
}

export async function approveInvoiceDraft(
  adminClient: SupabaseClient,
  draftId: string,
  actorProfileId: string
) {
  const { data: draftRow, error: draftLoadError } = await adminClient
    .from("job_invoice_drafts")
    .select("job_id")
    .eq("id", draftId)
    .maybeSingle();

  if (draftLoadError) {
    throw new ProductionError(draftLoadError.message, 500);
  }

  if (!draftRow) {
    throw new ProductionError("Invoice draft not found.", 404);
  }

  await reconcileInvoiceDraft(adminClient, draftRow.job_id, actorProfileId);

  const refreshed = await refreshDraftTotalsAndStatus(adminClient, draftId);
  const draft = refreshed.draft;
  const invoiceItems = refreshed.invoiceItems;

  const [job, { data: company }, { data: manifestItems }] = await Promise.all([
    loadJobInvoiceContext(adminClient, draft.job_id),
    adminClient
      .from("companies")
      .select("company_name")
      .eq("id", draft.company_id)
      .maybeSingle(),
    adminClient
      .from("production_items")
      .select(MANIFEST_ITEM_SELECT)
      .eq("job_id", draft.job_id)
      .is("deleted_at", null),
  ]);

  const acceptedQuoteContext = await loadAcceptedQuoteContext(
    adminClient,
    job.quote_version_id
  );

  const readiness = buildInvoiceApprovalReadiness({
    draft,
    invoiceItems,
    quoteItems: acceptedQuoteContext.quoteItems,
    manifestItems: (manifestItems ?? []) as ManifestItemRecord[],
    companyName: company?.company_name ?? null,
    quoteLinked: Boolean(draft.quote_id),
  });

  if (!readiness.canApprove) {
    throw new ProductionError(
      readiness.blockingReasons[0] ??
        "Invoice draft cannot be approved yet.",
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
      subtotal: draft.subtotal,
      tax_total: draft.tax_total,
      total: draft.total,
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

export async function reopenInvoiceDraft(
  adminClient: SupabaseClient,
  draftId: string,
  reason: string,
  actorProfileId: string
) {
  const trimmedReason = reason.trim();

  if (!trimmedReason) {
    throw new ProductionError("A reason is required to reopen the invoice draft.", 400);
  }

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

  if (draft.status !== "approved") {
    throw new ProductionError("Only approved invoice drafts can be reopened.", 400);
  }

  const refreshed = await refreshDraftTotalsAndStatus(adminClient, draftId);
  const nextStatus: InvoiceDraftStatus =
    refreshed.unpricedCount > 0 ? "needs_pricing" : "ready_for_review";
  const reopenNote = `[Reopened ${new Date().toISOString().slice(0, 10)}] ${trimmedReason}`;
  const internalNote = draft.internal_note
    ? `${draft.internal_note}\n\n${reopenNote}`
    : reopenNote;

  const { data: reopenedDraft, error: reopenError } = await adminClient
    .from("job_invoice_drafts")
    .update({
      status: nextStatus,
      approved_by: null,
      approved_at: null,
      internal_note: internalNote,
      subtotal: refreshed.draft.subtotal,
      tax_total: refreshed.draft.tax_total,
      total: refreshed.draft.total,
    })
    .eq("id", draftId)
    .select(INVOICE_DRAFT_SELECT)
    .single();

  if (reopenError || !reopenedDraft) {
    throw new ProductionError(
      reopenError?.message ?? "Unable to reopen invoice draft.",
      500
    );
  }

  const job = await loadJobInvoiceContext(adminClient, draft.job_id);

  await adminClient
    .from("jobs")
    .update({ commercial_status: "invoice_review" })
    .eq("id", draft.job_id);

  await logInvoiceActivity(adminClient, {
    activityType: INVOICE_ACTIVITY_TYPES.invoiceDraftReopened,
    description: `Invoice draft reopened for ${job.job_reference}: ${trimmedReason}`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    jobId: job.id,
    invoiceDraftId: draftId,
    actorProfileId,
    metadata: { reason: trimmedReason },
  });

  return reopenedDraft as InvoiceDraftRecord;
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
      itemName: item.item_name,
      description: buildXeroLineDescription(item),
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
