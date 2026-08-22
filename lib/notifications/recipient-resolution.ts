import type { SupabaseClient } from "@supabase/supabase-js";

import {
  loadProfileNotificationContext,
  type ProfileNotificationContext,
} from "@/lib/notifications/profile-recipient";
import {
  INTERNAL_NOTIFICATION_TYPES,
  type CustomerNotificationType,
  type InternalNotificationType,
  type NotificationAudience,
  type NotificationType,
} from "@/lib/notifications/notification-types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string) {
  return EMAIL_PATTERN.test(value.trim());
}

export async function resolveCustomerRecipient(
  adminClient: SupabaseClient,
  input: {
    contactId?: string | null;
    companyId?: string | null;
    profileId?: string | null;
  }
) {
  if (input.profileId) {
    const profile = await loadProfileNotificationContext(adminClient, input.profileId);

    if (profile) {
      return {
        email: profile.email,
        name: profile.fullName,
        contactId: input.contactId ?? null,
        profileId: profile.id,
      };
    }
  }

  if (input.contactId) {
    const { data: contact, error } = await adminClient
      .from("contacts")
      .select("id, email, full_name")
      .eq("id", input.contactId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (contact?.email && isValidEmail(contact.email)) {
      return {
        email: contact.email.trim().toLowerCase(),
        name: contact.full_name as string | null,
        contactId: contact.id as string,
      };
    }
  }

  if (input.companyId) {
    const { data: company, error } = await adminClient
      .from("companies")
      .select("accounts_email, company_name")
      .eq("id", input.companyId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (company?.accounts_email && isValidEmail(company.accounts_email)) {
      return {
        email: company.accounts_email.trim().toLowerCase(),
        name: company.company_name as string | null,
        contactId: input.contactId ?? null,
      };
    }
  }

  return null;
}

export function resolveInternalRecipients(emails: string[]) {
  return emails
    .map((email) => email.trim().toLowerCase())
    .filter((email) => isValidEmail(email));
}

export function audienceForType(type: NotificationType): NotificationAudience {
  if ((INTERNAL_NOTIFICATION_TYPES as readonly string[]).includes(type)) {
    return "internal";
  }

  return "customer";
}

export function isCustomerType(
  type: NotificationType
): type is CustomerNotificationType {
  return audienceForType(type) === "customer";
}

export function isInternalType(
  type: NotificationType
): type is InternalNotificationType {
  return audienceForType(type) === "internal";
}
