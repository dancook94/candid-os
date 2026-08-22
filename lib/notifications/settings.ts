import {
  CUSTOMER_NOTIFICATION_TYPES,
  DEFAULT_INTERNAL_ROUTING,
  INTERNAL_NOTIFICATION_TYPES,
  INTERNAL_RECIPIENT_GROUPS,
  type CustomerNotificationType,
  type InternalNotificationType,
  type InternalRecipientGroup,
} from "@/lib/notifications/notification-types";

export type NotificationSettingsPayload = {
  customer: Record<CustomerNotificationType, boolean>;
  internal: Record<InternalNotificationType, boolean>;
  recipientGroups: Record<InternalRecipientGroup, string[]>;
  routing: Record<InternalNotificationType, InternalRecipientGroup[]>;
};

function defaultCustomerToggles(): Record<CustomerNotificationType, boolean> {
  return {
    customer_registration_received: true,
    customer_account_approved: true,
    quote_ready: true,
    quote_revised: true,
    quote_accepted_customer: true,
    quote_accepted_confirmation: true,
    artwork_uploaded_confirmation: true,
    artwork_changes_requested: true,
    proof_ready: true,
    proof_changes_requested: true,
    proof_approved: true,
    production_started: true,
    ready_for_collection: true,
    dispatched: true,
    job_completed: true,
    invoice_available: true,
  };
}

function defaultInternalToggles(): Record<InternalNotificationType, boolean> {
  return {
    internal_new_registration: true,
    internal_quote_request_received: true,
    new_quote_request: true,
    quote_accepted_internal: true,
    quote_accepted: true,
    artwork_uploaded: true,
    proof_approved: true,
    production_exception: true,
    printfactory_unmatched_file: true,
    additional_billable_work: true,
    job_ready_for_invoice: true,
    invoice_xero_error: true,
  };
}

function defaultRecipientGroups(): Record<InternalRecipientGroup, string[]> {
  return {
    sales: [],
    artwork: [],
    production: [],
    accounts: [],
    admin: [],
  };
}

export function getDefaultNotificationSettings(): NotificationSettingsPayload {
  return {
    customer: defaultCustomerToggles(),
    internal: defaultInternalToggles(),
    recipientGroups: defaultRecipientGroups(),
    routing: { ...DEFAULT_INTERNAL_ROUTING },
  };
}

export function normalizeNotificationSettings(
  raw: unknown
): NotificationSettingsPayload {
  const defaults = getDefaultNotificationSettings();

  if (!raw || typeof raw !== "object") {
    return defaults;
  }

  const record = raw as Record<string, unknown>;
  const internal = {
    ...defaults.internal,
    ...(isRecord(record.internal) ? (record.internal as typeof defaults.internal) : {}),
  };

  if (
    isRecord(record.internal) &&
    record.internal.internal_quote_request_received === undefined &&
    record.internal.new_quote_request !== undefined
  ) {
    internal.internal_quote_request_received = Boolean(record.internal.new_quote_request);
  }

  return {
    customer: {
      ...defaults.customer,
      ...(isRecord(record.customer) ? (record.customer as typeof defaults.customer) : {}),
    },
    internal,
    recipientGroups: {
      ...defaults.recipientGroups,
      ...normalizeRecipientGroups(record.recipientGroups),
    },
    routing: {
      ...defaults.routing,
      ...(isRecord(record.routing) ? (record.routing as typeof defaults.routing) : {}),
    },
  };
}

function normalizeRecipientGroups(value: unknown) {
  const groups = defaultRecipientGroups();

  if (!isRecord(value)) {
    return groups;
  }

  for (const group of INTERNAL_RECIPIENT_GROUPS) {
    const emails = value[group];

    if (Array.isArray(emails)) {
      groups[group] = emails
        .map((entry) => String(entry).trim().toLowerCase())
        .filter(Boolean);
    }
  }

  return groups;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isCustomerNotificationEnabled(
  settings: NotificationSettingsPayload,
  type: CustomerNotificationType
) {
  return settings.customer[type] !== false;
}

export function isInternalNotificationEnabled(
  settings: NotificationSettingsPayload,
  type: InternalNotificationType
) {
  return settings.internal[type] !== false;
}

export function resolveInternalRecipientEmails(
  settings: NotificationSettingsPayload,
  type: InternalNotificationType
) {
  const groups = settings.routing[type] ?? DEFAULT_INTERNAL_ROUTING[type] ?? [];
  const emails = new Set<string>();

  for (const group of groups) {
    for (const email of settings.recipientGroups[group] ?? []) {
      emails.add(email);
    }
  }

  return Array.from(emails);
}
