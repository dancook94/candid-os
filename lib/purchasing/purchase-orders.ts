import type { SupabaseClient } from "@supabase/supabase-js";

export const PURCHASE_ORDER_STATUSES = [
  "draft",
  "issued",
  "partially_received",
  "received",
  "cancelled",
] as const;

export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export type PurchaseOrderBadgeStatus =
  | "pending"
  | "draft"
  | "sent"
  | "accepted"
  | "declined";

export type PurchaseOrderListItem = {
  id: string;
  reference: string;
  supplierName: string;
  status: PurchaseOrderStatus | "unknown";
  statusLabel: string;
  badgeStatus: PurchaseOrderBadgeStatus;
  totalIncVat: number | null;
  createdAt: string;
  issuedAt: string | null;
};

type RevisionSnapshot = {
  supplier_name: string | null;
  total_inc_vat: number | string | null;
  issued_at: string | null;
};

type PurchaseOrderListRow = {
  id: string;
  po_number: string | null;
  status: string;
  created_at: string;
  suppliers: { name: string | null } | { name: string | null }[] | null;
  issued_revision: RevisionSnapshot | RevisionSnapshot[] | null;
  draft_revision: RevisionSnapshot | RevisionSnapshot[] | null;
};

const statusPresentation: Record<
  PurchaseOrderStatus,
  { label: string; badgeStatus: PurchaseOrderBadgeStatus }
> = {
  draft: { label: "Draft", badgeStatus: "draft" },
  issued: { label: "Issued", badgeStatus: "sent" },
  partially_received: {
    label: "Partially received",
    badgeStatus: "pending",
  },
  received: { label: "Received", badgeStatus: "accepted" },
  cancelled: { label: "Cancelled", badgeStatus: "declined" },
};

const PURCHASE_ORDER_LIST_SELECT = [
  "id",
  "po_number",
  "status",
  "created_at",
  "suppliers(name)",
  "issued_revision:purchase_order_revisions!purchase_orders_current_issued_revision_fkey(supplier_name,total_inc_vat,issued_at)",
  "draft_revision:purchase_order_revisions!purchase_orders_current_draft_revision_fkey(supplier_name,total_inc_vat,issued_at)",
].join(",");

export function isPurchaseOrderStatus(
  status: string
): status is PurchaseOrderStatus {
  return (PURCHASE_ORDER_STATUSES as readonly string[]).includes(status);
}

export function formatPurchaseOrderDate(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(date);
}

function isPurchaseOrderListRow(value: unknown): value is PurchaseOrderListRow {
  if (!value || typeof value !== "object") {
    return false;
  }

  const row = value as PurchaseOrderListRow;

  return (
    typeof row.id === "string" &&
    typeof row.status === "string" &&
    typeof row.created_at === "string" &&
    (row.po_number === null || typeof row.po_number === "string")
  );
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

export function describePurchaseOrderStatus(status: string) {
  if (isPurchaseOrderStatus(status)) {
    return {
      status,
      statusLabel: statusPresentation[status].label,
      badgeStatus: statusPresentation[status].badgeStatus,
    };
  }

  return {
    status: "unknown" as const,
    statusLabel: status.split("_").join(" ") || "Unknown",
    badgeStatus: "draft" as const,
  };
}

export function toPurchaseOrderListItem(
  row: PurchaseOrderListRow
): PurchaseOrderListItem {
  const issuedRevision = one(row.issued_revision);
  const draftRevision = one(row.draft_revision);
  const supplier = one(row.suppliers);
  const displayRevision = issuedRevision ?? draftRevision;
  const status = describePurchaseOrderStatus(row.status);

  return {
    id: row.id,
    reference: row.po_number?.trim() || "Draft",
    supplierName:
      displayRevision?.supplier_name?.trim() ||
      supplier?.name?.trim() ||
      "Supplier unavailable",
    status: status.status,
    statusLabel: status.statusLabel,
    badgeStatus: status.badgeStatus,
    totalIncVat: parseMoney(displayRevision?.total_inc_vat),
    createdAt: row.created_at,
    issuedAt: issuedRevision?.issued_at ?? null,
  };
}

export function purchaseOrderListErrorMessage(error: {
  code?: string;
  message?: string;
}) {
  const message = error.message ?? "";
  const schemaMissing =
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    message.includes("Could not find the table") ||
    (message.includes("relation") && message.includes("does not exist"));

  if (schemaMissing) {
    return "Purchase orders are not available in this database yet.";
  }

  return "Purchase orders could not be loaded.";
}

export async function loadPurchaseOrderList(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("purchase_orders")
    .select(PURCHASE_ORDER_LIST_SELECT)
    .order("created_at", { ascending: false });

  if (error) {
    return {
      orders: [] as PurchaseOrderListItem[],
      errorMessage: purchaseOrderListErrorMessage(error),
    };
  }

  const rows = ((data ?? []) as unknown[]).filter(isPurchaseOrderListRow);

  return {
    orders: rows.map(toPurchaseOrderListItem),
    errorMessage: null,
  };
}
