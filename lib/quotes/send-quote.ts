import type { SupabaseClient } from "@supabase/supabase-js";

import { getCommunicationConfig } from "@/lib/communications/config";
import { syncOpportunityFromQuoteEvent } from "@/lib/crm/opportunity-stage-sync";
import { notifyQuoteReadySafe } from "@/lib/notifications/triggers";
import type { SendNotificationResult } from "@/lib/notifications/send-notification";
import { revalidateQuoteWorkflowRoutes } from "@/lib/quote-route-revalidation";

export type SendQuoteInput = {
  quoteId: string;
  versionId: string;
  changedBy: string;
};

export type SendQuoteEmailDetails = {
  notificationId: string | null;
  intendedRecipient: string | null;
  actualRecipient: string | null;
  redirected: boolean;
  providerMessageId: string | null;
  error: string | null;
  errorCode: string | null;
};

export type SendQuoteSuccessResult = {
  ok: true;
  quoteSent: true;
  emailSent: boolean;
  emailError: string | null;
  communicationMode: string;
  opportunitySynced: boolean;
  opportunitySkippedReason: string | null;
  opportunitySyncError: string | null;
  email: SendQuoteEmailDetails;
};

export type SendQuoteFailureResult = {
  ok: false;
  quoteSent: false;
  message: string;
};

export type SendQuoteResult = SendQuoteSuccessResult | SendQuoteFailureResult;

type QuoteReadyNotificationResult =
  | SendNotificationResult
  | { ok: false; skippedReason: string }
  | { ok: false; notificationIds: string[]; results: SendNotificationResult["results"]; skippedReason?: string };

function failure(message: string): SendQuoteFailureResult {
  return { ok: false, quoteSent: false, message };
}

function getNotificationMessage(
  notification: QuoteReadyNotificationResult
): string | null {
  if ("adminMessage" in notification && notification.adminMessage) {
    return notification.adminMessage;
  }

  if ("failureReason" in notification && notification.failureReason) {
    return notification.failureReason;
  }

  if ("skippedReason" in notification && notification.skippedReason) {
    return notification.skippedReason;
  }

  return null;
}

export function interpretQuoteReadyNotificationResult(
  notification: QuoteReadyNotificationResult
): Pick<SendQuoteSuccessResult, "emailSent" | "emailError" | "email"> {
  const deliveryResults =
    "results" in notification && notification.results.length > 0
      ? notification.results
      : [];

  const primaryResult = deliveryResults[0] ?? null;
  const notificationIds =
    "notificationIds" in notification ? notification.notificationIds : [];

  const emailSent = deliveryResults.some((result) => result.status === "sent");
  const failureResult = deliveryResults.find((result) => result.status === "failed");
  const suppressedResult = deliveryResults.find(
    (result) => result.status === "suppressed"
  );

  let emailError: string | null = null;

  if (!emailSent) {
    emailError =
      failureResult?.error ??
      getNotificationMessage(notification) ??
      (suppressedResult ? "Email delivery was suppressed." : null) ??
      "Quote email could not be delivered.";
  }

  return {
    emailSent,
    emailError,
    email: {
      notificationId: primaryResult?.notificationId ?? notificationIds[0] ?? null,
      intendedRecipient: primaryResult?.intendedRecipientEmail ?? null,
      actualRecipient: primaryResult?.recipientEmail ?? null,
      redirected: false,
      providerMessageId: primaryResult?.providerMessageId ?? null,
      error: failureResult?.error ?? emailError,
      errorCode: failureResult?.errorCode ?? null,
    },
  };
}

export function buildSendQuoteResponse(
  input: {
    opportunityResult:
      | { ok: true; opportunityId?: string; stage?: string; skipped?: true; reason?: string }
      | { ok: false; message: string };
    notification: QuoteReadyNotificationResult;
  }
): SendQuoteSuccessResult {
  const { emailSent, emailError, email } = interpretQuoteReadyNotificationResult(
    input.notification
  );

  const communicationMode = getCommunicationConfig().mode;

  const opportunitySynced =
    input.opportunityResult.ok &&
    !("skipped" in input.opportunityResult && input.opportunityResult.skipped) &&
    "opportunityId" in input.opportunityResult;

  const opportunitySkippedReason =
    input.opportunityResult.ok &&
    "skipped" in input.opportunityResult &&
    input.opportunityResult.skipped
      ? input.opportunityResult.reason ?? "skipped"
      : null;

  const opportunitySyncError =
    !input.opportunityResult.ok && "message" in input.opportunityResult
      ? input.opportunityResult.message
      : null;

  return {
    ok: true,
    quoteSent: true,
    emailSent,
    emailError,
    communicationMode,
    opportunitySynced,
    opportunitySkippedReason,
    opportunitySyncError,
    email,
  };
}

export async function sendQuoteAsStaff(
  adminClient: SupabaseClient,
  userClient: SupabaseClient,
  input: SendQuoteInput
): Promise<SendQuoteResult> {
  const { quoteId, versionId, changedBy } = input;
  const now = new Date().toISOString();

  const { data: quote, error: quoteError } = await adminClient
    .from("quotes")
    .select(
      "id, company_id, contact_id, opportunity_id, quote_request_id, status, current_version, project_name"
    )
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError) {
    return failure(quoteError.message);
  }

  if (!quote) {
    return failure("Quote not found.");
  }

  if (!quote.company_id || !quote.contact_id) {
    return failure("Quote must have a company and contact before it can be sent.");
  }

  const { data: version, error: versionError } = await adminClient
    .from("quote_versions")
    .select("id, version_number, version_status")
    .eq("id", versionId)
    .eq("quote_id", quoteId)
    .maybeSingle();

  if (versionError) {
    return failure(versionError.message);
  }

  if (!version) {
    return failure("Quote version not found.");
  }

  if (version.version_status !== "draft") {
    return failure("Only draft quote versions can be sent.");
  }

  const { count: lineItemCount, error: lineItemError } = await adminClient
    .from("quote_items")
    .select("id", { count: "exact", head: true })
    .eq("quote_version_id", version.id);

  if (lineItemError) {
    return failure(lineItemError.message);
  }

  if (!lineItemCount || lineItemCount < 1) {
    return failure("Add at least one line item before sending the quote.");
  }

  const { error: supersedeError } = await adminClient
    .from("quote_versions")
    .update({ version_status: "superseded" })
    .eq("quote_id", quoteId)
    .eq("version_status", "sent")
    .neq("id", version.id);

  if (supersedeError) {
    return failure(supersedeError.message);
  }

  const { error: quoteUpdateError } = await adminClient
    .from("quotes")
    .update({
      status: "sent",
      current_version: version.version_number,
      updated_at: now,
    })
    .eq("id", quoteId);

  if (quoteUpdateError) {
    return failure(quoteUpdateError.message);
  }

  const { error: versionUpdateError } = await adminClient
    .from("quote_versions")
    .update({
      version_status: "sent",
      sent_at: now,
    })
    .eq("id", version.id);

  if (versionUpdateError) {
    return failure(versionUpdateError.message);
  }

  if (quote.quote_request_id) {
    const { error: requestUpdateError } = await adminClient
      .from("quote_requests")
      .update({ request_status: "quoted" })
      .eq("id", quote.quote_request_id);

    if (requestUpdateError) {
      return failure(requestUpdateError.message);
    }
  }

  const opportunityResult = await syncOpportunityFromQuoteEvent(userClient, {
    quoteId,
    event: "quote_sent",
    changedBy,
  });

  const notification = await notifyQuoteReadySafe(adminClient, {
    quoteId,
    versionId: version.id,
    contactId: quote.contact_id,
  });

  revalidateQuoteWorkflowRoutes({
    quoteId,
    quoteRequestId: quote.quote_request_id ?? null,
    opportunityId: quote.opportunity_id ?? null,
  });

  const response = buildSendQuoteResponse({
    opportunityResult,
    notification,
  });

  if (
    response.email.intendedRecipient &&
    response.email.actualRecipient &&
    response.email.intendedRecipient !== response.email.actualRecipient
  ) {
    response.email.redirected = true;
  }

  return response;
}
