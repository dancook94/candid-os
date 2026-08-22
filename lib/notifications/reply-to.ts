import type { NotificationType } from "@/lib/notifications/notification-types";
import { normalizeNotificationType } from "@/lib/notifications/notification-types";

const DEFAULT_SALES_REPLY_TO = "quotes@candidcreative.uk";
const DEFAULT_ACCOUNTS_REPLY_TO = "accounts@candidcreative.uk";

function readReplyTo(envKey: string, fallback: string) {
  return process.env[envKey]?.trim() || fallback;
}

/** Central Reply-To resolution for outbound notification emails. */
export function resolveNotificationReplyTo(type: NotificationType | string): string | undefined {
  const normalizedType = normalizeNotificationType(String(type));

  switch (normalizedType) {
    case "customer_registration_received":
    case "customer_account_approved":
    case "internal_quote_request_received":
    case "new_quote_request":
    case "quote_ready":
    case "quote_revised":
    case "quote_accepted_customer":
    case "quote_accepted_confirmation":
    case "customer_artwork_received":
    case "artwork_received_manually":
    case "candid_creating_artwork":
    case "new_quote_request":
    case "internal_new_registration":
    case "quote_accepted_internal":
    case "quote_accepted":
      return readReplyTo("RESEND_REPLY_TO_SALES", DEFAULT_SALES_REPLY_TO);

    case "job_ready_for_invoice":
    case "invoice_xero_error":
    case "additional_billable_work":
    case "invoice_available":
      return readReplyTo("RESEND_REPLY_TO_ACCOUNTS", DEFAULT_ACCOUNTS_REPLY_TO);

    case "internal_artwork_uploaded":
    case "artwork_changes_requested":
      return readReplyTo("RESEND_REPLY_TO_ARTWORK", DEFAULT_SALES_REPLY_TO);

    case "proof_ready":
    case "proof_changes_requested":
    case "proof_approved":
    case "production_started":
    case "production_exception":
    case "printfactory_unmatched_file":
    case "ready_for_collection":
    case "dispatched":
    case "job_completed":
      return readReplyTo("RESEND_REPLY_TO_PRODUCTION", DEFAULT_SALES_REPLY_TO);

    default:
      return readReplyTo("RESEND_REPLY_TO_SALES", DEFAULT_SALES_REPLY_TO);
  }
}
