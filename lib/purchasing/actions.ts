"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { buildLoginUrl } from "@/lib/auth-redirect";
import {
  PURCHASING_DASHBOARD_PATH,
  PURCHASING_NEW_PATH,
  purchaseOrderDetailPath,
  requirePurchasingPageAccess,
} from "@/lib/purchasing/access";
import {
  DUPLICATE_DRAFT_WINDOW_MS,
  createDraftErrorCode,
  isPurchaseOrderSupplierId,
  purchaseOrderCreateErrorLog,
  purchaseOrderIdFromCreateResult,
  recentDuplicateDraftId,
} from "@/lib/purchasing/create-draft";
import { loadSavedDraftLines } from "@/lib/purchasing/draft-editor-data";
import {
  readDraftTotals,
  saveDraftErrorMessage,
} from "@/lib/purchasing/draft-editor";
import { issueErrorMessage } from "@/lib/purchasing/issue";
import {
  processQueuedPurchaseOrderEmail,
  readDispatch,
} from "@/lib/purchasing/purchase-order-email";
import {
  loadIssuedPurchaseOrderContext,
  purchaseOrderCanSendEmail,
} from "@/lib/purchasing/purchase-order-issued";
import { receivePurchaseOrderErrorMessage } from "@/lib/purchasing/receive";
import { createClient } from "@/lib/supabase/server";

export async function createPurchaseOrderDraft(formData: FormData) {
  const supabase = await createClient();
  await requirePurchasingPageAccess(supabase);

  const supplierId = formData.get("supplierId");

  if (!isPurchaseOrderSupplierId(supplierId)) {
    redirect(`${PURCHASING_NEW_PATH}?error=invalid`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl(PURCHASING_NEW_PATH));
  }

  const cutoff = new Date(Date.now() - DUPLICATE_DRAFT_WINDOW_MS).toISOString();
  const { data: recentDrafts } = await supabase
    .from("purchase_orders")
    .select("id, created_at")
    .eq("supplier_id", supplierId)
    .eq("status", "draft")
    .eq("created_by", user.id)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1);

  const duplicateId = recentDuplicateDraftId(
    ((recentDrafts ?? []) as { id?: string; created_at?: string }[]).flatMap(
      (draft) =>
        draft.id && draft.created_at
          ? [{ id: draft.id, createdAt: draft.created_at }]
          : []
    ),
    Date.now()
  );

  if (duplicateId) {
    redirect(purchaseOrderDetailPath(duplicateId));
  }

  const { data, error } = await supabase.rpc("create_purchase_order", {
    p_supplier_id: supplierId,
  });
  const orderId = purchaseOrderIdFromCreateResult(data);

  if (error || !orderId) {
    if (error) {
      console.error(
        "create_purchase_order failed",
        purchaseOrderCreateErrorLog(error)
      );
    }

    redirect(
      `${PURCHASING_NEW_PATH}?error=${createDraftErrorCode(error)}`
    );
  }

  revalidatePath(PURCHASING_DASHBOARD_PATH);
  revalidatePath(purchaseOrderDetailPath(orderId));
  redirect(purchaseOrderDetailPath(orderId));
}

const DRAFT_PAYLOAD_KEYS = [
  "supplierOrdersEmail",
  "vatTreatment",
  "deliveryMethod",
  "deliveryRecipient",
  "deliveryLine1",
  "deliveryLine2",
  "deliveryCity",
  "deliveryCounty",
  "deliveryPostcode",
  "deliveryCountry",
  "deliveryInstructions",
  "deliveryDate",
  "deliveryChargeExVat",
  "deliveryChargeMethod",
  "lines",
  "deliveryAllocations",
] as const;

export async function savePurchaseOrderDraft(revisionId: string, payload: unknown) {
  const supabase = await createClient();
  await requirePurchasingPageAccess(supabase);

  if (!isPurchaseOrderSupplierId(revisionId) || !hasDraftPayloadKeys(payload)) {
    return { ok: false as const, message: "The draft could not be saved." };
  }

  const { data, error } = await supabase.rpc("save_purchase_order_draft", {
    p_revision_id: revisionId,
    p_payload: payload,
  });

  if (error) {
    console.error("save_purchase_order_draft failed", purchaseOrderCreateErrorLog(error));
    return { ok: false as const, message: saveDraftErrorMessage(error) };
  }

  const totals = readDraftTotals(data);
  const orderId = purchaseOrderIdFromCreateResult(data);
  const chargeMethod =
    payload.deliveryChargeMethod === "manual" ? "manual" : "proportional";
  const saved = await loadSavedDraftLines(supabase, revisionId, chargeMethod);

  revalidatePath(PURCHASING_DASHBOARD_PATH);
  if (orderId) {
    revalidatePath(purchaseOrderDetailPath(orderId));
  }

  if (!totals || !saved) {
    return {
      ok: false as const,
      message: "The draft was saved. Refresh the page before editing again.",
    };
  }

  return {
    ok: true as const,
    totals,
    supplierOrdersEmail: saved.supplierOrdersEmail,
    lines: saved.lines,
    deliveryAllocations: saved.deliveryAllocations,
  };
}

export async function issuePurchaseOrder(orderId: string, idempotencyKey: string) {
  const supabase = await createClient();
  await requirePurchasingPageAccess(supabase, purchaseOrderDetailPath(orderId));

  const key = idempotencyKey.trim();
  if (!isPurchaseOrderSupplierId(orderId) || key.length < 1 || key.length > 200) {
    return { ok: false as const, message: "The purchase order could not be issued." };
  }

  const { error } = await supabase.rpc("issue_purchase_order", {
    p_order_id: orderId,
    p_idempotency_key: key,
  });

  if (error) {
    console.error("issue_purchase_order failed", purchaseOrderCreateErrorLog(error));
    return { ok: false as const, message: issueErrorMessage(error) };
  }

  revalidatePath(PURCHASING_DASHBOARD_PATH);
  revalidatePath(purchaseOrderDetailPath(orderId));
  redirect(purchaseOrderDetailPath(orderId));
}

function isEmailAddress(value: string) {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function sendPurchaseOrderToSupplier(input: {
  orderId: string;
  revisionId: string;
  supplierOrdersEmail: string;
  confirmed: boolean;
}) {
  const supabase = await createClient();
  await requirePurchasingPageAccess(supabase, purchaseOrderDetailPath(input.orderId));

  if (!input.confirmed) {
    return { ok: false as const, message: "Confirm before emailing the supplier." };
  }

  if (!isPurchaseOrderSupplierId(input.orderId) || !isPurchaseOrderSupplierId(input.revisionId)) {
    return { ok: false as const, message: "The purchase order could not be emailed." };
  }

  const email = input.supplierOrdersEmail.trim().toLowerCase();
  if (!isEmailAddress(email)) {
    return { ok: false as const, message: "Supplier email is not valid." };
  }

  const context = await loadIssuedPurchaseOrderContext(supabase, input.orderId);
  if (!context || context.revisionId !== input.revisionId) {
    return { ok: false as const, message: "Only the current issued revision can be emailed." };
  }

  if (!purchaseOrderCanSendEmail(context.emailDispatch)) {
    return {
      ok: false as const,
      message: "This purchase order was already emailed or is still sending.",
    };
  }

  const { error: emailError } = await supabase.rpc("set_issued_purchase_order_orders_email", {
    p_revision_id: input.revisionId,
    p_email: email,
  });

  if (emailError) {
    return {
      ok: false as const,
      message: purchaseOrderSendErrorMessage(emailError),
    };
  }

  const { data: enqueueData, error: enqueueError } = await supabase.rpc(
    "enqueue_purchase_order_email",
    { p_revision_id: input.revisionId }
  );

  const dispatch = readDispatch(enqueueData);
  if (enqueueError || !dispatch) {
    return {
      ok: false as const,
      message: "The supplier email could not be queued.",
    };
  }

  if (dispatch.status === "sent") {
    revalidatePath(PURCHASING_DASHBOARD_PATH);
    revalidatePath(purchaseOrderDetailPath(input.orderId));
    return { ok: true as const, status: "already_sent" as const };
  }

  const processed = await processQueuedPurchaseOrderEmail(
    supabase,
    input.orderId,
    input.revisionId,
    dispatch
  );

  revalidatePath(PURCHASING_DASHBOARD_PATH);
  revalidatePath(purchaseOrderDetailPath(input.orderId));

  if (!processed.ok) {
    return { ok: false as const, message: processed.message };
  }

  return {
    ok: true as const,
    status: processed.status,
    providerMessageId: processed.providerMessageId ?? null,
  };
}

export async function receivePurchaseOrderGoods(input: {
  orderId: string;
  idempotencyKey: string;
  lines: Array<{ lineId: string; quantity: string }>;
}) {
  const supabase = await createClient();
  await requirePurchasingPageAccess(supabase, purchaseOrderDetailPath(input.orderId));

  if (!isPurchaseOrderSupplierId(input.orderId)) {
    return { ok: false as const, message: "The receipt could not be recorded." };
  }

  const key = input.idempotencyKey.trim();
  if (key.length < 1 || key.length > 200) {
    return { ok: false as const, message: "The receipt could not be recorded." };
  }

  const payload = input.lines.flatMap((line) => {
    if (!isPurchaseOrderSupplierId(line.lineId)) {
      return [];
    }
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return [];
    }
    return [{ lineId: line.lineId, quantity: Math.round(quantity * 10_000) / 10_000 }];
  });

  if (payload.length === 0) {
    return { ok: false as const, message: "Enter at least one quantity to receive." };
  }

  const { error } = await supabase.rpc("receive_purchase_order", {
    p_order_id: input.orderId,
    p_idempotency_key: key,
    p_lines: payload.map((line) => ({
      lineId: line.lineId,
      quantity: line.quantity,
    })),
  });

  if (error) {
    return { ok: false as const, message: receivePurchaseOrderErrorMessage(error) };
  }

  revalidatePath(PURCHASING_DASHBOARD_PATH);
  revalidatePath(purchaseOrderDetailPath(input.orderId));
  return { ok: true as const };
}

function purchaseOrderSendErrorMessage(error: { message?: string } | null) {
  const message = error?.message?.trim() ?? "";
  if (message === "Supplier email is not valid") {
    return "Supplier email is not valid.";
  }
  if (message === "This purchase order was already emailed to the supplier") {
    return "This purchase order was already emailed to the supplier.";
  }
  if (message === "Only the current issued revision can be updated") {
    return "Only the current issued revision can be emailed.";
  }
  return message.endsWith(".") ? message : `${message}.`;
}

function hasDraftPayloadKeys(payload: unknown): payload is Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return DRAFT_PAYLOAD_KEYS.every((key) => key in record);
}
