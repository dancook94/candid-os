import type { SupabaseClient } from "@supabase/supabase-js";

import { isPurchaseOrderSupplierId } from "@/lib/purchasing/create-draft";
export type IssuedPurchaseOrderLine = {
  id: string;
  lineNumber: number;
  description: string;
  supplierSku: string | null;
  unit: string;
  quantity: number;
  receivedQuantity: number;
};

export type PurchaseOrderReceiptHistory = {
  id: string;
  receivedAt: string;
  receivedByName: string | null;
  lines: Array<{ lineId: string; quantity: number }>;
};

import type { PurchaseOrderEmailDispatch } from "@/lib/purchasing/purchase-order-dispatch-ui";

export type { PurchaseOrderEmailDispatch } from "@/lib/purchasing/purchase-order-dispatch-ui";
export {
  purchaseOrderCanSendEmail,
  purchaseOrderEmailRecipientEditable,
} from "@/lib/purchasing/purchase-order-dispatch-ui";

export type IssuedPurchaseOrderContext = {
  orderId: string;
  revisionId: string;
  poNumber: string;
  supplierOrdersEmail: string;
  lines: IssuedPurchaseOrderLine[];
  receipts: PurchaseOrderReceiptHistory[];
  emailDispatch: PurchaseOrderEmailDispatch | null;
};

const ISSUED_SELECT = [
  "id",
  "po_number",
  "status",
  "current_issued_revision:purchase_order_revisions!purchase_orders_current_issued_revision_fkey(" +
    "id, supplier_orders_email, state, pdf_storage_path, pdf_sha256, issued_at, " +
    "purchase_order_lines(id, line_number, description, supplier_sku, unit, quantity)" +
    ")",
].join(",");

export async function loadIssuedPurchaseOrderContext(
  supabase: SupabaseClient,
  orderId: string
): Promise<IssuedPurchaseOrderContext | null> {
  if (!isPurchaseOrderSupplierId(orderId)) {
    return null;
  }

  const { data, error } = await supabase
    .from("purchase_orders")
    .select(ISSUED_SELECT)
    .eq("id", orderId)
    .maybeSingle();

  if (error || !data || typeof data !== "object") {
    return null;
  }

  const row = data as {
    id: string;
    po_number: string | null;
    current_issued_revision:
      | {
          id: string;
          supplier_orders_email: string | null;
          state: string;
          pdf_storage_path: string | null;
          pdf_sha256: string | null;
          purchase_order_lines: Array<{
            id: string;
            line_number: number;
            description: string;
            supplier_sku: string | null;
            unit: string;
            quantity: number | string;
          }> | null;
        }
      | Array<{
          id: string;
          supplier_orders_email: string | null;
          state: string;
          pdf_storage_path: string | null;
          pdf_sha256: string | null;
          purchase_order_lines: Array<{
            id: string;
            line_number: number;
            description: string;
            supplier_sku: string | null;
            unit: string;
            quantity: number | string;
          }> | null;
        }>
      | null;
  };

  const revision = Array.isArray(row.current_issued_revision)
    ? row.current_issued_revision[0]
    : row.current_issued_revision;

  if (
    !revision ||
    revision.state !== "issued" ||
    !revision.pdf_storage_path ||
    !revision.pdf_sha256
  ) {
    return null;
  }

  const lineIds = (revision.purchase_order_lines ?? []).map((line) => String(line.id));
  const receivedByLine = new Map<string, number>();

  if (lineIds.length > 0) {
    const { data: receiptLines } = await supabase
      .from("purchase_order_receipt_lines")
      .select("line_id, quantity_received")
      .in("line_id", lineIds);

    for (const entry of receiptLines ?? []) {
      const lineId = String(entry.line_id);
      const qty = Number(entry.quantity_received);
      if (!Number.isFinite(qty)) {
        continue;
      }
      receivedByLine.set(lineId, roundQty((receivedByLine.get(lineId) ?? 0) + qty));
    }
  }

  const lines = [...(revision.purchase_order_lines ?? [])]
    .sort((left, right) => left.line_number - right.line_number)
    .map((line) => {
      const quantity = Number(line.quantity);
      const id = String(line.id);
      return {
        id,
        lineNumber: line.line_number,
        description: line.description,
        supplierSku: line.supplier_sku?.trim() || null,
        unit: line.unit,
        quantity: Number.isFinite(quantity) ? quantity : 0,
        receivedQuantity: receivedByLine.get(id) ?? 0,
      };
    });

  const [{ data: receipts }, { data: dispatch }] = await Promise.all([
    supabase
      .from("purchase_order_receipts")
      .select(
        "id, received_at, receiver:profiles!purchase_order_receipts_received_by_fkey(full_name), purchase_order_receipt_lines(line_id, quantity_received)"
      )
      .eq("purchase_order_id", orderId)
      .order("received_at", { ascending: false }),
    supabase
      .from("purchase_order_email_dispatches")
      .select("id, status, attempt_count, provider_message_id, last_error, created_at, updated_at")
      .eq("revision_id", revision.id)
      .maybeSingle(),
  ]);

  const receiptHistory: PurchaseOrderReceiptHistory[] = (receipts ?? []).flatMap((receipt) => {
    if (!receipt.id || !receipt.received_at) {
      return [];
    }
    const receiver = Array.isArray(receipt.receiver) ? receipt.receiver[0] : receipt.receiver;
    const receiptLines = Array.isArray(receipt.purchase_order_receipt_lines)
      ? receipt.purchase_order_receipt_lines
      : [];
    return [
      {
        id: String(receipt.id),
        receivedAt: String(receipt.received_at),
        receivedByName:
          receiver && typeof receiver === "object" && "full_name" in receiver
            ? String(receiver.full_name ?? "") || null
            : null,
        lines: receiptLines.flatMap((entry) => {
          const qty = Number(entry.quantity_received);
          if (!entry.line_id || !Number.isFinite(qty) || qty <= 0) {
            return [];
          }
          return [{ lineId: String(entry.line_id), quantity: qty }];
        }),
      },
    ];
  });

  const emailDispatch = dispatch
    ? {
        id: String(dispatch.id),
        status: String(dispatch.status),
        attemptCount: Number(dispatch.attempt_count) || 0,
        providerMessageId: dispatch.provider_message_id?.trim() || null,
        lastError: dispatch.last_error?.trim() || null,
        createdAt: String(dispatch.created_at),
        updatedAt: String(dispatch.updated_at),
      }
    : null;

  return {
    orderId: String(row.id),
    revisionId: String(revision.id),
    poNumber: row.po_number?.trim() || "Purchase order",
    supplierOrdersEmail: revision.supplier_orders_email?.trim() ?? "",
    lines,
    receipts: receiptHistory,
    emailDispatch,
  };
}

function roundQty(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
