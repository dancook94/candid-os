import type { SupabaseClient } from "@supabase/supabase-js";

import {
  INVOICE_DRAFT_SELECT,
  INVOICE_ITEM_SELECT,
} from "@/lib/invoice/constants";
import {
  deriveInvoiceDisplayStatus,
  invoiceDisplayStatusNeedsAttention,
  type InvoiceDisplayStatus,
} from "@/lib/invoice/display-status";
import type { InvoiceDraftRecord, InvoiceItemRecord } from "@/lib/invoice/types";
import { invoiceLineNeedsPricing, normalizeInvoiceItemNumericFields } from "@/lib/invoice/money";
import { calculateInvoiceTotalGroups } from "@/lib/invoice/total-groups";
import { getBillableInvoiceLines } from "@/lib/invoice/validation";
import { MANIFEST_ITEM_SELECT } from "@/lib/manifest/constants";
import type { ManifestItemRecord } from "@/lib/manifest/types";
import {
  isMissingInvoiceSchemaError,
  isMissingProductionSchemaError,
} from "@/lib/production/errors";
import { createAdminClient } from "@/lib/supabase/admin";

export const ADMIN_INVOICE_VIEW_OPTIONS = [
  "needs_attention",
  "drafts",
  "approved",
  "sent_to_xero",
  "all",
] as const;

export type AdminInvoiceView = (typeof ADMIN_INVOICE_VIEW_OPTIONS)[number];

export type AdminInvoicesListSearchParams = {
  search?: string;
  view?: string;
  status?: string;
  company?: string;
  needs_pricing?: string;
  approved?: string;
  xero_status?: string;
  production_complete?: string;
  from?: string;
  to?: string;
};

export type AdminInvoicesListFilters = {
  search: string;
  view: AdminInvoiceView;
  displayStatus: InvoiceDisplayStatus | null;
  companyId: string | null;
  needsPricingOnly: boolean;
  approvedFilter: "all" | "approved" | "not_approved";
  xeroStatus: string | null;
  productionComplete: "all" | "complete" | "not_complete";
  fromDate: string | null;
  toDate: string | null;
};

export type AdminInvoiceListRow = {
  id: string;
  jobId: string;
  jobReference: string;
  projectName: string;
  companyId: string;
  companyName: string;
  quoteId: string | null;
  quoteNumber: string | null;
  purchaseOrderNumber: string | null;
  draftStatus: string;
  displayStatus: InvoiceDisplayStatus;
  commercialStatus: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  originalQuoteTotal: number;
  changesTotal: number;
  unpricedCount: number;
  productionCompletedAt: string | null;
  approvedAt: string | null;
  xeroStatus: string | null;
  xeroInvoiceNumber: string | null;
  updatedAt: string;
  canApprove: boolean;
};

export type AdminInvoicesListMetrics = {
  needsPricingCount: number;
  readyForReviewCount: number;
  readyForXeroCount: number;
  totalDraftValue: number;
};

export type AdminInvoicesListResult = {
  invoices: AdminInvoiceListRow[];
  metrics: AdminInvoicesListMetrics;
  schemaMissing: boolean;
  queryError: string | null;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDateParam(value: string | undefined) {
  if (!value || !DATE_PATTERN.test(value)) {
    return null;
  }

  return value;
}

function parseViewParam(value: string | undefined): AdminInvoiceView {
  if (
    value &&
    (ADMIN_INVOICE_VIEW_OPTIONS as readonly string[]).includes(value)
  ) {
    return value as AdminInvoiceView;
  }

  return "needs_attention";
}

export function parseAdminInvoicesListFilters(
  params: AdminInvoicesListSearchParams
): AdminInvoicesListFilters {
  const approved = params.approved?.toLowerCase();
  const productionComplete = params.production_complete?.toLowerCase();

  return {
    search: params.search?.trim() ?? "",
    view: parseViewParam(params.view),
    displayStatus: params.status?.trim()
      ? (params.status.trim() as InvoiceDisplayStatus)
      : null,
    companyId: params.company?.trim() || null,
    needsPricingOnly: params.needs_pricing === "1" || params.needs_pricing === "true",
    approvedFilter:
      approved === "approved"
        ? "approved"
        : approved === "not_approved"
          ? "not_approved"
          : "all",
    xeroStatus: params.xero_status?.trim() || null,
    productionComplete:
      productionComplete === "complete"
        ? "complete"
        : productionComplete === "not_complete"
          ? "not_complete"
          : "all",
    fromDate: parseDateParam(params.from),
    toDate: parseDateParam(params.to),
  };
}

export function hasActiveAdminInvoicesFilters(filters: AdminInvoicesListFilters) {
  return (
    filters.search.length > 0 ||
    filters.view !== "needs_attention" ||
    filters.displayStatus !== null ||
    filters.companyId !== null ||
    filters.needsPricingOnly ||
    filters.approvedFilter !== "all" ||
    filters.xeroStatus !== null ||
    filters.productionComplete !== "all" ||
    filters.fromDate !== null ||
    filters.toDate !== null
  );
}

function countUnpricedItems(items: InvoiceItemRecord[]) {
  return getBillableInvoiceLines(items.map(normalizeInvoiceItemNumericFields)).filter(
    invoiceLineNeedsPricing
  ).length;
}

function matchesView(displayStatus: InvoiceDisplayStatus, view: AdminInvoiceView) {
  switch (view) {
    case "needs_attention":
      return invoiceDisplayStatusNeedsAttention(displayStatus);
    case "drafts":
      return (
        displayStatus === "draft" ||
        displayStatus === "needs_pricing" ||
        displayStatus === "ready_for_review"
      );
    case "approved":
      return displayStatus === "ready_for_xero";
    case "sent_to_xero":
      return displayStatus === "pushed_to_xero" || displayStatus === "invoiced";
    case "all":
      return displayStatus !== "cancelled";
    default:
      return true;
  }
}

function matchesSearch(row: AdminInvoiceListRow, search: string) {
  if (!search) {
    return true;
  }

  const haystack = [
    row.jobReference,
    row.projectName,
    row.companyName,
    row.quoteNumber ? `Q-${row.quoteNumber}` : "",
    row.purchaseOrderNumber ?? "",
    row.xeroInvoiceNumber ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(search.toLowerCase());
}

export async function fetchAdminInvoicesList(
  _supabase: SupabaseClient,
  filters: AdminInvoicesListFilters
): Promise<AdminInvoicesListResult> {
  const adminClient = createAdminClient();

  const { data: drafts, error: draftsError } = await adminClient
    .from("job_invoice_drafts")
    .select(INVOICE_DRAFT_SELECT)
    .neq("status", "cancelled")
    .order("updated_at", { ascending: false });

  if (draftsError) {
    if (
      isMissingProductionSchemaError(draftsError) ||
      isMissingInvoiceSchemaError(draftsError)
    ) {
      return {
        invoices: [],
        metrics: {
          needsPricingCount: 0,
          readyForReviewCount: 0,
          readyForXeroCount: 0,
          totalDraftValue: 0,
        },
        schemaMissing: true,
        queryError: null,
      };
    }

    if (process.env.NODE_ENV === "development") {
      console.error("[admin invoices] draft query failed:", draftsError.message);
    }

    return {
      invoices: [],
      metrics: {
        needsPricingCount: 0,
        readyForReviewCount: 0,
        readyForXeroCount: 0,
        totalDraftValue: 0,
      },
      schemaMissing: false,
      queryError: draftsError.message,
    };
  }

  const typedDrafts = (drafts ?? []) as InvoiceDraftRecord[];

  if (typedDrafts.length === 0) {
    return {
      invoices: [],
      metrics: {
        needsPricingCount: 0,
        readyForReviewCount: 0,
        readyForXeroCount: 0,
        totalDraftValue: 0,
      },
      schemaMissing: false,
      queryError: null,
    };
  }

  const draftIds = typedDrafts.map((draft) => draft.id);
  const jobIds = [...new Set(typedDrafts.map((draft) => draft.job_id))];
  const companyIds = [...new Set(typedDrafts.map((draft) => draft.company_id))];
  const quoteIds = [
    ...new Set(
      typedDrafts.map((draft) => draft.quote_id).filter((id): id is string => Boolean(id))
    ),
  ];

  const [itemsResult, jobsResult, companiesResult, quotesResult, manifestResult] =
    await Promise.all([
    adminClient
      .from("job_invoice_items")
      .select(INVOICE_ITEM_SELECT)
      .in("invoice_draft_id", draftIds)
      .is("deleted_at", null),
    adminClient
      .from("jobs")
      .select(
        "id, job_reference, project_name, commercial_status, status, updated_at"
      )
      .in("id", jobIds),
    adminClient.from("companies").select("id, company_name").in("id", companyIds),
    quoteIds.length
      ? adminClient.from("quotes").select("id, quote_number").in("id", quoteIds)
      : Promise.resolve({ data: [], error: null }),
    adminClient
      .from("production_items")
      .select(MANIFEST_ITEM_SELECT)
      .in("job_id", jobIds)
      .is("deleted_at", null),
  ]);

  if (
    itemsResult.error ||
    jobsResult.error ||
    companiesResult.error ||
    quotesResult.error ||
    manifestResult.error
  ) {
    const message =
      itemsResult.error?.message ??
      jobsResult.error?.message ??
      companiesResult.error?.message ??
      quotesResult.error?.message ??
      manifestResult.error?.message ??
      "Unable to load invoice drafts.";

    if (process.env.NODE_ENV === "development") {
      console.error("[admin invoices] related query failed:", message);
    }

    return {
      invoices: [],
      metrics: {
        needsPricingCount: 0,
        readyForReviewCount: 0,
        readyForXeroCount: 0,
        totalDraftValue: 0,
      },
      schemaMissing: false,
      queryError: message,
    };
  }

  const itemsByDraftId = new Map<string, InvoiceItemRecord[]>();
  for (const item of (itemsResult.data ?? []) as InvoiceItemRecord[]) {
    const bucket = itemsByDraftId.get(item.invoice_draft_id) ?? [];
    bucket.push(item);
    itemsByDraftId.set(item.invoice_draft_id, bucket);
  }

  const jobById = new Map(
    (jobsResult.data ?? []).map((job) => [job.id as string, job])
  );
  const companyNameById = new Map(
    (companiesResult.data ?? []).map((company) => [
      company.id as string,
      company.company_name as string,
    ])
  );
  const quoteNumberById = new Map(
    (quotesResult.data ?? []).map((quote) => [
      quote.id as string,
      String(quote.quote_number),
    ])
  );

  const manifestByJobId = new Map<string, ManifestItemRecord[]>();
  for (const item of (manifestResult.data ?? []) as ManifestItemRecord[]) {
    const bucket = manifestByJobId.get(item.job_id) ?? [];
    bucket.push(item);
    manifestByJobId.set(item.job_id, bucket);
  }

  const productionCompletedAtByJobId = new Map<string, string | null>();
  if (jobIds.length > 0) {
    const { data: productionItems } = await adminClient
      .from("production_items")
      .select("job_id, completed_at, production_status")
      .in("job_id", jobIds)
      .is("deleted_at", null);

    for (const jobId of jobIds) {
      const jobItems = (productionItems ?? []).filter(
        (item) => item.job_id === jobId
      );

      if (jobItems.length === 0) {
        productionCompletedAtByJobId.set(jobId, null);
        continue;
      }

      const allCompleted = jobItems.every(
        (item) => item.production_status === "completed"
      );
      const latestCompletedAt = jobItems
        .map((item) => item.completed_at)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1);

      productionCompletedAtByJobId.set(
        jobId,
        allCompleted ? latestCompletedAt ?? null : null
      );
    }
  }

  const rows: AdminInvoiceListRow[] = typedDrafts.map((draft) => {
    const items = (itemsByDraftId.get(draft.id) ?? []).map(normalizeInvoiceItemNumericFields);
    const jobManifest = manifestByJobId.get(draft.job_id) ?? [];
    const manifestById = new Map(jobManifest.map((item) => [item.id, item]));
    const totalGroups = calculateInvoiceTotalGroups(items, manifestById);
    const unpricedCount = countUnpricedItems(items);
    const displayStatus = deriveInvoiceDisplayStatus({
      status: draft.status,
      unpricedCount,
    });
    const job = jobById.get(draft.job_id);
    const productionCompletedAt =
      productionCompletedAtByJobId.get(draft.job_id) ?? null;

    return {
      id: draft.id,
      jobId: draft.job_id,
      jobReference: job?.job_reference ?? "Unknown job",
      projectName: job?.project_name ?? "Unknown project",
      companyId: draft.company_id,
      companyName: companyNameById.get(draft.company_id) ?? "Unknown company",
      quoteId: draft.quote_id,
      quoteNumber: draft.quote_id
        ? quoteNumberById.get(draft.quote_id) ?? null
        : null,
      purchaseOrderNumber: draft.purchase_order_number,
      draftStatus: draft.status,
      displayStatus,
      commercialStatus: job?.commercial_status ?? "not_ready",
      subtotal: totalGroups.finalInvoice.subtotal,
      taxTotal: totalGroups.finalInvoice.tax_total,
      total: totalGroups.finalInvoice.total,
      originalQuoteTotal: totalGroups.originalQuote.total,
      changesTotal: totalGroups.productionChanges.total,
      unpricedCount,
      productionCompletedAt,
      approvedAt: draft.approved_at,
      xeroStatus: draft.xero_status,
      xeroInvoiceNumber: draft.xero_invoice_number,
      updatedAt: draft.updated_at,
      canApprove:
        displayStatus === "ready_for_review" &&
        unpricedCount === 0 &&
        getBillableInvoiceLines(items).length > 0,
    };
  });

  const metrics: AdminInvoicesListMetrics = {
    needsPricingCount: rows.filter((row) => row.displayStatus === "needs_pricing")
      .length,
    readyForReviewCount: rows.filter(
      (row) => row.displayStatus === "ready_for_review"
    ).length,
    readyForXeroCount: rows.filter((row) => row.displayStatus === "ready_for_xero")
      .length,
    totalDraftValue: rows
      .filter((row) => row.displayStatus !== "invoiced")
      .reduce((sum, row) => sum + row.total, 0),
  };

  const filtered = rows.filter((row) => {
    if (!matchesView(row.displayStatus, filters.view)) {
      return false;
    }

    if (filters.displayStatus && row.displayStatus !== filters.displayStatus) {
      return false;
    }

    if (filters.companyId && row.companyId !== filters.companyId) {
      return false;
    }

    if (filters.needsPricingOnly && row.unpricedCount === 0) {
      return false;
    }

    if (filters.approvedFilter === "approved" && row.displayStatus !== "ready_for_xero") {
      return false;
    }

    if (
      filters.approvedFilter === "not_approved" &&
      row.displayStatus === "ready_for_xero"
    ) {
      return false;
    }

    if (filters.xeroStatus && row.xeroStatus !== filters.xeroStatus) {
      return false;
    }

    if (filters.productionComplete === "complete" && !row.productionCompletedAt) {
      return false;
    }

    if (filters.productionComplete === "not_complete" && row.productionCompletedAt) {
      return false;
    }

    if (filters.fromDate && row.updatedAt.slice(0, 10) < filters.fromDate) {
      return false;
    }

    if (filters.toDate && row.updatedAt.slice(0, 10) > filters.toDate) {
      return false;
    }

    return matchesSearch(row, filters.search);
  });

  return {
    invoices: filtered,
    metrics,
    schemaMissing: false,
    queryError: null,
  };
}
