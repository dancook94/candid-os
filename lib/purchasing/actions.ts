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

function hasDraftPayloadKeys(payload: unknown): payload is Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return DRAFT_PAYLOAD_KEYS.every((key) => key in record);
}
