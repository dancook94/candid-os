import { purchaseOrderPdfSha256 } from "@/lib/purchasing/purchase-order-pdf";

export type PurchaseOrderPdfUploadResult =
  | { status: "uploaded" }
  | { status: "exists" }
  | { status: "failed"; message: string };

export type PurchaseOrderPdfAttachResult =
  | { ok: true }
  | { ok: false; alreadyRecorded: boolean; message: string };

export function officialPurchaseOrderPdfPath(orderId: string, revisionId: string) {
  return `purchase-orders/${orderId}/revisions/${revisionId}.pdf`;
}

export function purchaseOrderPdfAction(
  storedPath: string | null,
  expectedPath: string
): "download" | "create" | "reject" {
  if (storedPath === null) {
    return "create";
  }
  if (storedPath === expectedPath) {
    return "download";
  }
  return "reject";
}

export async function commitPurchaseOrderPdf(options: {
  rendered: Buffer;
  upload: (bytes: Buffer) => Promise<PurchaseOrderPdfUploadResult>;
  downloadExisting: () => Promise<{ ok: true; bytes: Buffer } | { ok: false; message: string }>;
  attach: (bytes: Buffer) => Promise<PurchaseOrderPdfAttachResult>;
}): Promise<
  { ok: true; bytes: Buffer } | { ok: false; message: string; alreadyRecorded: boolean }
> {
  const uploaded = await options.upload(options.rendered);
  if (uploaded.status === "failed") {
    return {
      ok: false,
      message: "The purchase order PDF could not be stored.",
      alreadyRecorded: false,
    };
  }

  const official =
    uploaded.status === "exists" ? await options.downloadExisting() : { ok: true as const, bytes: options.rendered };
  if (!official.ok) {
    return {
      ok: false,
      message: "The purchase order PDF could not be stored.",
      alreadyRecorded: false,
    };
  }

  const attached = await options.attach(official.bytes);
  if (!attached.ok) {
    return {
      ok: false,
      message: "The purchase order PDF could not be stored.",
      alreadyRecorded: attached.alreadyRecorded,
    };
  }

  return { ok: true, bytes: official.bytes };
}

export function purchaseOrderPdfAttachment(bytes: Buffer) {
  return {
    sha256: purchaseOrderPdfSha256(bytes),
    byteSize: bytes.length,
  };
}
