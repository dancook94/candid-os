import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferenceKey,
} from "@/lib/customer-settings/permissions";
import {
  CUSTOMER_TYPE_PREFERENCE_KEY,
  ESSENTIAL_CUSTOMER_NOTIFICATION_TYPES,
  type CustomerNotificationType,
} from "@/lib/notifications/notification-types";

export async function isCustomerEmailEnabled(
  adminClient: SupabaseClient,
  input: {
    contactId?: string | null;
    notificationType: CustomerNotificationType;
  }
): Promise<{ enabled: boolean; reason: string | null }> {
  if (ESSENTIAL_CUSTOMER_NOTIFICATION_TYPES.has(input.notificationType)) {
    return { enabled: true, reason: null };
  }

  const preferenceKey = CUSTOMER_TYPE_PREFERENCE_KEY[input.notificationType];

  if (!preferenceKey || !input.contactId) {
    return { enabled: true, reason: null };
  }

  const { data, error } = await adminClient
    .from("contact_notification_preferences")
    .select(preferenceKey)
    .eq("contact_id", input.contactId)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01") {
      return { enabled: true, reason: null };
    }

    throw error;
  }

  if (!data) {
    return {
      enabled: DEFAULT_NOTIFICATION_PREFERENCES[preferenceKey as NotificationPreferenceKey],
      reason: null,
    };
  }

  const enabled = Boolean(data[preferenceKey as keyof typeof data]);

  return {
    enabled,
    reason: enabled ? null : "suppressed_by_contact_preference",
  };
}
