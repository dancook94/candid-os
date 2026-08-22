import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getDefaultNotificationSettings,
  normalizeNotificationSettings,
  type NotificationSettingsPayload,
} from "@/lib/notifications/settings";
import { isNotificationsSchemaMissingError } from "@/lib/notifications/errors";

const SINGLETON_KEY = "default";

export async function loadNotificationSettings(
  adminClient: SupabaseClient
): Promise<NotificationSettingsPayload> {
  const { data, error } = await adminClient
    .from("notification_settings")
    .select("settings")
    .eq("singleton_key", SINGLETON_KEY)
    .maybeSingle();

  if (error) {
    if (isNotificationsSchemaMissingError(error)) {
      return getDefaultNotificationSettings();
    }

    throw error;
  }

  return normalizeNotificationSettings(data?.settings);
}

export async function saveNotificationSettings(
  adminClient: SupabaseClient,
  settings: NotificationSettingsPayload
) {
  const now = new Date().toISOString();

  const { error } = await adminClient.from("notification_settings").upsert(
    {
      singleton_key: SINGLETON_KEY,
      settings,
      updated_at: now,
    },
    { onConflict: "singleton_key" }
  );

  if (error) {
    throw error;
  }
}
