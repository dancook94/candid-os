import type { SupabaseClient } from "@supabase/supabase-js";

import { isPurchaseOrderSupplierId } from "@/lib/purchasing/create-draft";
import {
  purchaseOrderPdfFilename,
  renderPurchaseOrderPdf,
  type PurchaseOrderPdfDocument,
} from "@/lib/purchasing/purchase-order-pdf";
import {
  commitPurchaseOrderPdf,
  officialPurchaseOrderPdfPath,
  purchaseOrderPdfAction,
  purchaseOrderPdfAttachment,
} from "@/lib/purchasing/purchase-order-pdf-store";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "purchase-order-files";

type PdfLineRow = {
  line_number: number;
  description: string;
  supplier_sku: string | null;
  unit: string;
  quantity: number | string;
  unit_price_ex_vat: number | string;
  line_total_ex_vat: number | string;
};

type IssuedRevisionRow = {
  id: string;
  purchase_order_id: string;
  state: string;
  revision_number: number;
  supplier_name: string;
  supplier_orders_email: string | null;
  issued_at: string | null;
  delivery_recipient: string | null;
  delivery_line_1: string | null;
  delivery_line_2: string | null;
  delivery_city: string | null;
  delivery_county: string | null;
  delivery_postcode: string | null;
  delivery_country: string | null;
  delivery_instructions: string | null;
  delivery_date: string | null;
  delivery_charge_ex_vat: number | string;
  goods_ex_vat: number | string;
  subtotal_ex_vat: number | string;
  vat_rate: number | string;
  vat_total: number | string;
  total_inc_vat: number | string;
  pdf_storage_path: string | null;
  pdf_sha256: string | null;
  purchase_order_lines: PdfLineRow[] | null;
};

export type PurchaseOrderPdfResult =
  | { ok: true; bytes: Buffer; filename: string }
  | { ok: false; status: number; message: string };

export async function loadPurchaseOrderPdf(
  supabase: SupabaseClient,
  orderId: string
): Promise<PurchaseOrderPdfResult> {
  if (!isPurchaseOrderSupplierId(orderId)) {
    return { ok: false, status: 404, message: "This purchase order is not available." };
  }

  const { data, error } = await supabase
    .from("purchase_orders")
    .select(
      "po_number, current_issued_revision:purchase_order_revisions!purchase_orders_current_issued_revision_fkey(id, purchase_order_id, state, revision_number, supplier_name, supplier_orders_email, issued_at, delivery_recipient, delivery_line_1, delivery_line_2, delivery_city, delivery_county, delivery_postcode, delivery_country, delivery_instructions, delivery_date, delivery_charge_ex_vat, goods_ex_vat, subtotal_ex_vat, vat_rate, vat_total, total_inc_vat, pdf_storage_path, pdf_sha256, purchase_order_lines(line_number, description, supplier_sku, unit, quantity, unit_price_ex_vat, line_total_ex_vat))"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, status: 404, message: "This purchase order is not available." };
  }

  const revision = one(data.current_issued_revision);
  const poNumber = typeof data.po_number === "string" ? data.po_number : "";

  if (
    !revision ||
    revision.purchase_order_id !== orderId ||
    revision.state === "draft" ||
    !revision.issued_at
  ) {
    return { ok: false, status: 404, message: "This purchase order has not been issued." };
  }

  const expectedPath = officialPurchaseOrderPdfPath(orderId, revision.id);
  const pdfAction = purchaseOrderPdfAction(revision.pdf_storage_path, expectedPath);
  if (pdfAction === "reject") {
    return { ok: false, status: 404, message: "The purchase order PDF could not be downloaded." };
  }
  if (pdfAction === "download") {
    return downloadStoredPdf(supabase, expectedPath, poNumber);
  }

  const snapshot = snapshotFromRevision(poNumber, revision);
  if (!snapshot) {
    return { ok: false, status: 422, message: "The issued purchase order is incomplete." };
  }

  const bytes = await renderPurchaseOrderPdf(snapshot);
  const stored = await storePurchaseOrderPdf(supabase, orderId, revision.id, bytes);
  if (!stored.ok) {
    if (stored.alreadyStored) {
      const { data: storedRevision } = await supabase
        .from("purchase_order_revisions")
        .select("pdf_storage_path, purchase_order_id")
        .eq("id", revision.id)
        .maybeSingle();
      const storedPath =
        storedRevision?.purchase_order_id === orderId &&
        storedRevision.pdf_storage_path === expectedPath
          ? expectedPath
          : "";
      if (storedPath) {
        return downloadStoredPdf(supabase, storedPath, poNumber);
      }
    }
    return { ok: false, status: 422, message: stored.message };
  }

  return {
    ok: true,
    bytes: stored.bytes,
    filename: purchaseOrderPdfFilename(poNumber),
  };
}

async function downloadStoredPdf(
  supabase: SupabaseClient,
  path: string,
  poNumber: string
): Promise<PurchaseOrderPdfResult> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) {
    return { ok: false, status: 404, message: "The purchase order PDF could not be downloaded." };
  }

  return {
    ok: true,
    bytes: Buffer.from(await data.arrayBuffer()),
    filename: purchaseOrderPdfFilename(poNumber),
  };
}

async function storePurchaseOrderPdf(
  supabase: SupabaseClient,
  orderId: string,
  revisionId: string,
  bytes: Buffer
): Promise<
  { ok: true; bytes: Buffer } | { ok: false; message: string; alreadyStored: boolean; path: string }
> {
  const expectedPath = officialPurchaseOrderPdfPath(orderId, revisionId);
  const { data, error } = await supabase.rpc("assert_can_store_purchase_order_pdf", {
    p_revision_id: revisionId,
  });

  const path = readStoragePath(data);
  if (error || path !== expectedPath) {
    const message = error?.message ?? "";
    return {
      ok: false,
      message: message.includes("already stored")
        ? "The purchase order PDF is already stored."
        : "The purchase order PDF could not be stored.",
      alreadyStored: message.includes("already stored"),
      path: path === expectedPath ? path : "",
    };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      ok: false,
      message: "The purchase order PDF could not be stored.",
      alreadyStored: false,
      path,
    };
  }

  const committed = await commitPurchaseOrderPdf({
    rendered: bytes,
    upload: async (rendered) => {
      const upload = await admin.storage.from(BUCKET).upload(path, rendered, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (!upload.error) {
        return { status: "uploaded" };
      }
      if (uploadAlreadyExists(upload.error)) {
        return { status: "exists" };
      }
      return { status: "failed", message: upload.error.message };
    },
    downloadExisting: async () => {
      const downloaded = await admin.storage.from(BUCKET).download(path);
      if (downloaded.error || !downloaded.data) {
        return { ok: false, message: "The purchase order PDF could not be stored." };
      }
      return { ok: true, bytes: Buffer.from(await downloaded.data.arrayBuffer()) };
    },
    attach: async (official) => {
      const attachment = purchaseOrderPdfAttachment(official);
      const attached = await admin.rpc("attach_purchase_order_pdf", {
        p_revision_id: revisionId,
        p_path: path,
        p_sha256: attachment.sha256,
        p_byte_size: attachment.byteSize,
      });
      if (!attached.error) {
        return { ok: true };
      }
      const message = attached.error.message ?? "";
      return {
        ok: false,
        alreadyRecorded: /already stored/i.test(message),
        message,
      };
    },
  });

  if (!committed.ok) {
    return {
      ok: false,
      message: committed.message,
      alreadyStored: committed.alreadyRecorded,
      path,
    };
  }

  return { ok: true, bytes: committed.bytes };
}

function uploadAlreadyExists(error: { message?: string; statusCode?: string | number }) {
  const status = String(error.statusCode ?? "");
  return status === "409" || /already exists|duplicate/i.test(error.message ?? "");
}

function snapshotFromRevision(
  poNumber: string,
  revision: IssuedRevisionRow
): PurchaseOrderPdfDocument | null {
  if (
    !poNumber ||
    !revision.delivery_line_1 ||
    !revision.delivery_postcode ||
    !revision.issued_at ||
    !revision.purchase_order_lines?.length
  ) {
    return null;
  }

  const lines = [...revision.purchase_order_lines]
    .sort((left, right) => left.line_number - right.line_number)
    .map((line) => ({
      description: line.description,
      supplierSku: line.supplier_sku,
      unit: line.unit,
      quantity: numberValue(line.quantity),
      unitPriceExVat: numberValue(line.unit_price_ex_vat),
      lineTotalExVat: numberValue(line.line_total_ex_vat),
    }));

  return {
    poNumber,
    revisionNumber: revision.revision_number,
    supplierName: revision.supplier_name,
    supplierOrdersEmail: revision.supplier_orders_email,
    issuedAt: revision.issued_at,
    deliveryRecipient: revision.delivery_recipient,
    deliveryLine1: revision.delivery_line_1,
    deliveryLine2: revision.delivery_line_2,
    deliveryCity: revision.delivery_city,
    deliveryCounty: revision.delivery_county,
    deliveryPostcode: revision.delivery_postcode,
    deliveryCountry: revision.delivery_country,
    deliveryInstructions: revision.delivery_instructions,
    deliveryDate: revision.delivery_date,
    deliveryChargeExVat: numberValue(revision.delivery_charge_ex_vat),
    goodsExVat: numberValue(revision.goods_ex_vat),
    subtotalExVat: numberValue(revision.subtotal_ex_vat),
    vatRate: numberValue(revision.vat_rate),
    vatTotal: numberValue(revision.vat_total),
    totalIncVat: numberValue(revision.total_inc_vat),
    lines,
  };
}

function readStoragePath(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "";
  }
  const path = (data as { path?: unknown }).path;
  return typeof path === "string" ? path : "";
}

function numberValue(value: number | string) {
  return typeof value === "number" ? value : Number(value);
}

function one<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}
