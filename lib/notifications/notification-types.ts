export const NOTIFICATION_CHANNELS = ["email", "slack", "portal"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_AUDIENCES = ["customer", "staff", "internal"] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

export const NOTIFICATION_STATUSES = [
  "pending",
  "suppressed",
  "sending",
  "sent",
  "delivered",
  "failed",
  "bounced",
  "cancelled",
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const CUSTOMER_NOTIFICATION_TYPES = [
  "customer_registration_received",
  "customer_account_approved",
  "quote_ready",
  "quote_revised",
  "quote_accepted_customer",
  "quote_accepted_confirmation",
  "artwork_uploaded_confirmation",
  "artwork_changes_requested",
  "proof_ready",
  "proof_changes_requested",
  "proof_approved",
  "production_started",
  "ready_for_collection",
  "dispatched",
  "job_completed",
  "invoice_available",
] as const;

export const INTERNAL_NOTIFICATION_TYPES = [
  "internal_new_registration",
  "new_quote_request",
  "quote_accepted_internal",
  "quote_accepted",
  "artwork_uploaded",
  "proof_approved",
  "production_exception",
  "printfactory_unmatched_file",
  "additional_billable_work",
  "job_ready_for_invoice",
  "invoice_xero_error",
] as const;

export const NOTIFICATION_TYPES = [
  ...CUSTOMER_NOTIFICATION_TYPES,
  ...INTERNAL_NOTIFICATION_TYPES,
] as const;

export type CustomerNotificationType = (typeof CUSTOMER_NOTIFICATION_TYPES)[number];
export type InternalNotificationType = (typeof INTERNAL_NOTIFICATION_TYPES)[number];
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const INTERNAL_RECIPIENT_GROUPS = [
  "sales",
  "artwork",
  "production",
  "accounts",
  "admin",
] as const;

export type InternalRecipientGroup = (typeof INTERNAL_RECIPIENT_GROUPS)[number];

export const DEFAULT_INTERNAL_ROUTING: Record<
  InternalNotificationType,
  InternalRecipientGroup[]
> = {
  internal_new_registration: ["admin"],
  new_quote_request: ["sales"],
  quote_accepted_internal: ["sales", "production"],
  quote_accepted: ["sales", "production"],
  artwork_uploaded: ["artwork"],
  proof_approved: ["production"],
  production_exception: ["production"],
  printfactory_unmatched_file: ["production"],
  additional_billable_work: ["accounts"],
  job_ready_for_invoice: ["accounts"],
  invoice_xero_error: ["accounts", "admin"],
};

/** Maps customer notification types to contact preference keys (Phase 1). */
export const CUSTOMER_TYPE_PREFERENCE_KEY: Partial<
  Record<CustomerNotificationType, string>
> = {
  quote_ready: "quote_received",
  quote_revised: "quote_received",
  artwork_uploaded_confirmation: "job_started",
  production_started: "job_started",
  ready_for_collection: "job_ready",
  dispatched: "job_dispatched",
  job_completed: "job_ready",
  invoice_available: "invoice_available",
};

/** Transactional types that ignore contact opt-out. */
export const ESSENTIAL_CUSTOMER_NOTIFICATION_TYPES = new Set<CustomerNotificationType>([
  "customer_registration_received",
  "customer_account_approved",
  "quote_accepted_customer",
  "quote_accepted_confirmation",
]);

export const TESTABLE_NOTIFICATION_TYPES = [
  "customer_registration_received",
  "customer_account_approved",
  "quote_ready",
  "quote_accepted_customer",
  "quote_accepted_confirmation",
  "artwork_uploaded_confirmation",
  "new_quote_request",
  "internal_new_registration",
  "quote_accepted_internal",
  "quote_accepted",
  "artwork_uploaded",
  "job_ready_for_invoice",
] as const satisfies readonly NotificationType[];

export type TestableNotificationType = (typeof TESTABLE_NOTIFICATION_TYPES)[number];

export function formatNotificationTypeLabel(type: string) {
  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function normalizeNotificationType(type: string): NotificationType {
  if (type === "quote_accepted_confirmation") {
    return "quote_accepted_customer";
  }

  if (type === "quote_accepted") {
    return "quote_accepted_internal";
  }

  return type as NotificationType;
}
