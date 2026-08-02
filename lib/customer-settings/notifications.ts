import type { SupabaseClient } from "@supabase/supabase-js";

import { isMissingRelationError } from "@/lib/customer-settings/errors";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_PREFERENCE_KEYS,
  type NotificationPreferenceKey,
} from "@/lib/customer-settings/permissions";

export type ContactNotificationPreferences = Record<
  NotificationPreferenceKey,
  boolean
>;

export type NotificationPreferencesFeature = {
  available: boolean;
  preferences: ContactNotificationPreferences;
  updatedAt: string | null;
};

export function normalizeNotificationPreferences(
  row: Partial<Record<NotificationPreferenceKey, boolean>> | null | undefined
): ContactNotificationPreferences {
  const normalized = { ...DEFAULT_NOTIFICATION_PREFERENCES };

  for (const key of NOTIFICATION_PREFERENCE_KEYS) {
    if (typeof row?.[key] === "boolean") {
      normalized[key] = row[key]!;
    }
  }

  return normalized;
}

export async function loadContactNotificationPreferences(
  adminClient: SupabaseClient,
  contactId: string
): Promise<NotificationPreferencesFeature> {
  const { data, error } = await adminClient
    .from("contact_notification_preferences")
    .select(
      "quote_received, quote_reminder, artwork_approval_required, job_started, job_ready, job_dispatched, invoice_available, marketing, updated_at"
    )
    .eq("contact_id", contactId)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) {
      return {
        available: false,
        preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
        updatedAt: null,
      };
    }

    throw error;
  }

  if (!data) {
    return {
      available: true,
      preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
      updatedAt: null,
    };
  }

  return {
    available: true,
    preferences: normalizeNotificationPreferences(data),
    updatedAt: data.updated_at ?? null,
  };
}
