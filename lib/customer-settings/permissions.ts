/** Customer-editable contact columns on public.contacts */
export const CUSTOMER_EDITABLE_CONTACT_FIELDS = [
  "full_name",
  "job_title",
  "phone",
] as const;

/** Customer-editable company columns on public.companies */
export const CUSTOMER_EDITABLE_COMPANY_FIELDS = [
  "trading_name",
  "accounts_email",
  "phone",
  "website",
] as const;

/** Admin-only company fields — never accepted from customer APIs */
export const ADMIN_ONLY_COMPANY_FIELDS = [
  "company_name",
  "company_number",
  "vat_number",
  "payment_terms_days",
  "is_active",
  "credit_limit",
  "credit_status",
  "logo_storage_path",
  "logo_file_name",
  "logo_file_type",
  "logo_file_size",
] as const;

export const CONCURRENCY_CONFLICT_MESSAGE =
  "These details were updated elsewhere. Refresh and review before saving.";

export const ADMIN_LOCKED_FIELD_HINT =
  "Contact Candid Creative to update this information.";

export const NOTIFICATION_PREFERENCE_KEYS = [
  "quote_received",
  "quote_reminder",
  "artwork_approval_required",
  "job_started",
  "job_ready",
  "job_dispatched",
  "invoice_available",
  "marketing",
] as const;

export type NotificationPreferenceKey =
  (typeof NOTIFICATION_PREFERENCE_KEYS)[number];

export const DEFAULT_NOTIFICATION_PREFERENCES: Record<
  NotificationPreferenceKey,
  boolean
> = {
  quote_received: true,
  quote_reminder: true,
  artwork_approval_required: true,
  job_started: true,
  job_ready: true,
  job_dispatched: true,
  invoice_available: true,
  marketing: false,
};
