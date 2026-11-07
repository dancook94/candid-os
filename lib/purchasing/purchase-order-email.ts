import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { loadPurchaseOrderPdf } from "@/lib/purchasing/purchase-order-file";

export type ProcessPurchaseOrderEmailResult =
  | { ok: true; status: "sent" | "already_sent" | "queued"; providerMessageId?: string | null }
  | { ok: false; status: string; message: string };

type DispatchRow = {
  dispatchId: string;
  revisionId: string;
  status: string;
  attemptCount?: number;
  claimed?: boolean;
  claimToken?: string | null;
};

function readDispatch(data: unknown): DispatchRow | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  const dispatchId = typeof record.dispatchId === "string" ? record.dispatchId : null;
  const revisionId = typeof record.revisionId === "string" ? record.revisionId : null;
  const status = typeof record.status === "string" ? record.status : null;

  if (!dispatchId || !revisionId || !status) {
    return null;
  }

  return {
    dispatchId,
    revisionId,
    status,
    attemptCount:
      typeof record.attemptCount === "number" ? record.attemptCount : undefined,
    claimed: record.claimed === true,
    claimToken: typeof record.claimToken === "string" ? record.claimToken : null,
  };
}

export async function processQueuedPurchaseOrderEmail(
  supabase: SupabaseClient,
  orderId: string,
  revisionId: string,
  dispatch: DispatchRow
): Promise<ProcessPurchaseOrderEmailResult> {
  if (dispatch.status === "sent") {
    return { ok: true, status: "already_sent" };
  }

  if (dispatch.status !== "queued" && dispatch.status !== "failed") {
    return {
      ok: false,
      status: dispatch.status,
      message: "This purchase order email is not ready to send.",
    };
  }

  const admin = createAdminClient();
  const { data: claimData, error: claimError } = await admin.rpc("claim_purchase_order_email", {
    p_dispatch_id: dispatch.dispatchId,
  });

  if (claimError) {
    return {
      ok: false,
      status: "claim_failed",
      message: "The supplier email could not be claimed.",
    };
  }

  const claim = readDispatch(claimData);
  if (!claim?.claimed || !claim.claimToken) {
    const status = claim?.status ?? dispatch.status;
    if (status === "sent") {
      return { ok: true, status: "already_sent" };
    }
    return {
      ok: false,
      status,
      message: "The supplier email is already being sent.",
    };
  }

  const pdf = await loadPurchaseOrderPdf(supabase, orderId);
  if (!pdf.ok) {
    await completePurchaseOrderEmail(admin, claim.dispatchId, claim.claimToken, "failed", null, pdf.message);
    return { ok: false, status: "failed", message: pdf.message };
  }

  const subject = pdf.filename === "purchase-order.pdf" ? "Purchase order" : pdf.filename.replace(/\.pdf$/i, "");
  const html = [
    "<p>Please find the attached purchase order.</p>",
    "<p>If anything looks wrong, reply to this email and we will correct it.</p>",
  ].join("");
  const text = "Please find the attached purchase order.\n\nIf anything looks wrong, reply to this email and we will correct it.";

  const send = await sendPurchaseOrderEmailWithPdf({
    intendedRecipient: await readRecipientEmail(supabase, revisionId),
    subject,
    html,
    text,
    filename: pdf.filename,
    pdfBytes: pdf.bytes,
  });

  if (!send.ok) {
    const outcome = send.errorCode === "provider_request_failed" ? "unknown" : "failed";
    await completePurchaseOrderEmail(
      admin,
      claim.dispatchId,
      claim.claimToken,
      outcome,
      null,
      send.error
    );
    return { ok: false, status: outcome, message: send.error };
  }

  const providerId = send.providerMessageId;
  if (!providerId) {
    await completePurchaseOrderEmail(
      admin,
      claim.dispatchId,
      claim.claimToken,
      "unknown",
      null,
      "The email provider did not return a message id."
    );
    return {
      ok: false,
      status: "unknown",
      message: "The email provider did not confirm delivery.",
    };
  }

  await completePurchaseOrderEmail(
    admin,
    claim.dispatchId,
    claim.claimToken,
    "sent",
    providerId,
    null
  );

  return { ok: true, status: "sent", providerMessageId: providerId };
}

async function readRecipientEmail(supabase: SupabaseClient, revisionId: string) {
  const { data } = await supabase
    .from("purchase_order_revisions")
    .select("supplier_orders_email")
    .eq("id", revisionId)
    .maybeSingle();

  return String(data?.supplier_orders_email ?? "").trim().toLowerCase();
}

async function completePurchaseOrderEmail(
  admin: SupabaseClient,
  dispatchId: string,
  claimToken: string,
  outcome: "sent" | "failed" | "unknown",
  providerMessageId: string | null,
  error: string | null
) {
  await admin.rpc("complete_purchase_order_email", {
    p_dispatch_id: dispatchId,
    p_claim_token: claimToken,
    p_outcome: outcome,
    p_provider_message_id: providerMessageId,
    p_error: error,
  });
}

async function sendPurchaseOrderEmailWithPdf(input: {
  intendedRecipient: string;
  subject: string;
  html: string;
  text: string;
  filename: string;
  pdfBytes: Buffer;
}) {
  const { getResendConfigStatus } = await import("@/lib/notifications/config");
  const { applyCommunicationSafety } = await import("@/lib/communications/safety");
  const { getFromHeader } = await import("@/lib/notifications/templates");
  const { Resend } = await import("resend");

  const safety = applyCommunicationSafety({
    intendedRecipient: input.intendedRecipient,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });

  if (safety.mode === "suppressed" || !safety.shouldSend) {
    return {
      ok: false as const,
      error: "Email suppressed",
      errorCode: "email_disabled" as const,
    };
  }

  const config = getResendConfigStatus();
  if (!config.configured || !process.env.RESEND_API_KEY?.trim()) {
    return {
      ok: false as const,
      error: "Resend is not configured.",
      errorCode: "resend_not_configured" as const,
    };
  }

  const client = new Resend(process.env.RESEND_API_KEY.trim());
  try {
    const response = await client.emails.send({
      from: getFromHeader(),
      to: safety.actualRecipient,
      subject: safety.subject,
      html: safety.html,
      text: safety.text,
      attachments: [
        {
          filename: input.filename,
          content: input.pdfBytes,
        },
      ],
    });

    if (response.error) {
      return {
        ok: false as const,
        error: response.error.message,
        errorCode: "provider_rejection" as const,
      };
    }

    return {
      ok: true as const,
      status: "sent" as const,
      providerMessageId: response.data?.id ?? null,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Resend request failed.",
      errorCode: "provider_request_failed" as const,
    };
  }
}

export { readDispatch };
