import type { SupabaseClient } from "@supabase/supabase-js";

import { isPurchaseOrderSupplierId } from "@/lib/purchasing/create-draft";
import {
  describePurchaseOrderStatus,
  type PurchaseOrderBadgeStatus,
  type PurchaseOrderStatus,
} from "@/lib/purchasing/purchase-orders";

export type PurchaseOrderDetail = {
  id: string;
  reference: string;
  supplierName: string;
  ordersEmail: string | null;
  status: PurchaseOrderStatus | "unknown";
  statusLabel: string;
  badgeStatus: PurchaseOrderBadgeStatus;
  currency: string;
  vatTreatmentLabel: string;
  deliveryLabel: string;
  totalIncVat: number | null;
  createdAt: string;
  issuedAt: string | null;
  revisionNumber: number | null;
  lineCount: number;
};

type RevisionDetail = {
  id: string;
  supplier_name: string | null;
  supplier_orders_email: string | null;
  currency: string | null;
  vat_treatment: string | null;
  delivery_method: string | null;
  delivery_country: string | null;
  total_inc_vat: number | string | null;
  revision_number: number | null;
  issued_at: string | null;
  purchase_order_lines: { id: string }[] | null;
};

type PurchaseOrderDetailRow = {
  id: string;
  po_number: string | null;
  status: string;
  created_at: string;
  issued_revision: RevisionDetail | RevisionDetail[] | null;
  draft_revision: RevisionDetail | RevisionDetail[] | null;
};

const DETAIL_SELECT = [
  "id",
  "po_number",
  "status",
  "created_at",
  "issued_revision:purchase_order_revisions!purchase_orders_current_issued_revision_fkey(id,supplier_name,supplier_orders_email,currency,vat_treatment,delivery_method,delivery_country,total_inc_vat,revision_number,issued_at,purchase_order_lines(id))",
  "draft_revision:purchase_order_revisions!purchase_orders_current_draft_revision_fkey(id,supplier_name,supplier_orders_email,currency,vat_treatment,delivery_method,delivery_country,total_inc_vat,revision_number,issued_at,purchase_order_lines(id))",
].join(",");

const vatTreatmentLabels: Record<string, string> = {
  standard: "Standard",
  zero_rated: "Zero-rated",
  exempt: "Exempt",
  reverse_charge: "Reverse charge",
  outside_scope: "Outside scope",
};

export function toPurchaseOrderDetail(
  row: PurchaseOrderDetailRow
): PurchaseOrderDetail {
  const issuedRevision = one(row.issued_revision);
  const draftRevision = one(row.draft_revision);
  const revision = issuedRevision ?? draftRevision;
  const status = describePurchaseOrderStatus(row.status);

  return {
    id: row.id,
    reference: row.po_number?.trim() || "Draft",
    supplierName: revision?.supplier_name?.trim() || "Supplier unavailable",
    ordersEmail: revision?.supplier_orders_email?.trim() || null,
    status: status.status,
    statusLabel: status.statusLabel,
    badgeStatus: status.badgeStatus,
    currency: revision?.currency?.trim() || "GBP",
    vatTreatmentLabel: labelVatTreatment(revision?.vat_treatment),
    deliveryLabel: labelDelivery(
      revision?.delivery_method,
      revision?.delivery_country
    ),
    totalIncVat: parseMoney(revision?.total_inc_vat),
    createdAt: row.created_at,
    issuedAt: issuedRevision?.issued_at ?? null,
    revisionNumber:
      typeof revision?.revision_number === "number"
        ? revision.revision_number
        : null,
    lineCount: Array.isArray(revision?.purchase_order_lines)
      ? revision.purchase_order_lines.length
      : 0,
  };
}

export async function loadPurchaseOrderDetail(
  supabase: SupabaseClient,
  orderId: string
) {
  if (!isPurchaseOrderSupplierId(orderId)) {
    return {
      detail: null,
      errorMessage: "This purchase order is not available.",
    };
  }

  const { data, error } = await supabase
    .from("purchase_orders")
    .select(DETAIL_SELECT)
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    return {
      detail: null,
      errorMessage: "This purchase order could not be loaded.",
    };
  }

  if (!data || typeof data !== "object") {
    return {
      detail: null,
      errorMessage: "This purchase order is not available.",
    };
  }

  const row = data as PurchaseOrderDetailRow;

  if (typeof row.id !== "string" || typeof row.created_at !== "string") {
    return {
      detail: null,
      errorMessage: "This purchase order could not be loaded.",
    };
  }

  return {
    detail: toPurchaseOrderDetail(row),
    errorMessage: null,
  };
}

function labelVatTreatment(value: string | null | undefined) {
  if (!value) {
    return "Not recorded";
  }

  return vatTreatmentLabels[value] ?? value.split("_").join(" ");
}

function labelDelivery(
  method: string | null | undefined,
  country: string | null | undefined
) {
  const methodLabel =
    method === "workshop"
      ? "Workshop"
      : method === "custom"
        ? "Custom address"
        : method
          ? method
          : "Not recorded";

  if (!country) {
    return methodLabel;
  }

  return `${methodLabel}, ${country}`;
}

function one<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function parseMoney(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const amount = typeof value === "number" ? value : Number(value);

  return Number.isFinite(amount) ? amount : null;
}
