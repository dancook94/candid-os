import { NextResponse } from "next/server";

import {
  assertConcurrency,
  requireCustomerSettingsContext,
} from "@/lib/customer-settings/auth";
import { CRM_ACTIVITY_TYPES } from "@/lib/customer-settings/activity";
import { customerSettingsErrorResponse } from "@/lib/customer-settings/api-response";
import { CustomerSettingsError, isMissingRelationError } from "@/lib/customer-settings/errors";
import {
  NOTIFICATION_PREFERENCE_KEYS,
  type NotificationPreferenceKey,
} from "@/lib/customer-settings/permissions";
import { commitCustomerSettingsChange } from "@/lib/customer-settings/save-with-activity";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type UpdateNotificationsBody = Partial<
  Record<NotificationPreferenceKey, boolean>
> & {
  updatedAt?: string | null;
};

const PREFERENCE_SELECT =
  "quote_received, quote_reminder, artwork_approval_required, job_started, job_ready, job_dispatched, invoice_available, marketing, updated_at";

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const context = await requireCustomerSettingsContext(supabase, user);

    if (!context.contact) {
      return NextResponse.json(
        { error: "Notification preferences require a linked CRM contact." },
        { status: 409 }
      );
    }

    let body: UpdateNotificationsBody;

    try {
      body = (await request.json()) as UpdateNotificationsBody;
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const adminClient = createAdminClient();

    const { data: existing, error: existingError } = await adminClient
      .from("contact_notification_preferences")
      .select(PREFERENCE_SELECT)
      .eq("contact_id", context.contact.id)
      .maybeSingle();

    if (existingError && !isMissingRelationError(existingError)) {
      throw new CustomerSettingsError(existingError.message, 500);
    }

    if (existingError && isMissingRelationError(existingError)) {
      return NextResponse.json(
        {
          error:
            "Notification preferences require the customer settings database migration.",
        },
        { status: 501 }
      );
    }

    assertConcurrency(existing?.updated_at ?? null, body.updatedAt ?? null);

    const updates: Record<string, boolean> = {};
    const changedFields: string[] = [];

    for (const key of NOTIFICATION_PREFERENCE_KEYS) {
      if (typeof body[key] === "boolean") {
        updates[key] = body[key]!;
        changedFields.push(key);
      }
    }

    if (changedFields.length === 0) {
      return NextResponse.json({ error: "No changes to save." }, { status: 400 });
    }

    const now = new Date().toISOString();
    const preferenceSnapshot = existing
      ? {
          ...existing,
          contact_id: context.contact.id,
          company_id: context.company.id,
        }
      : null;
    const wasInsert = !existing;

    await commitCustomerSettingsChange({
      context,
      devOperationLabel: "notifications.update",
      operation: async () => {
        const payload = {
          contact_id: context.contact!.id,
          company_id: context.company.id,
          ...updates,
          updated_at: now,
        };

        const { error } = existing
          ? await adminClient
              .from("contact_notification_preferences")
              .update(payload)
              .eq("contact_id", context.contact!.id)
          : await adminClient.from("contact_notification_preferences").insert({
              ...payload,
              quote_received: updates.quote_received ?? true,
              quote_reminder: updates.quote_reminder ?? true,
              artwork_approval_required:
                updates.artwork_approval_required ?? true,
              job_started: updates.job_started ?? true,
              job_ready: updates.job_ready ?? true,
              job_dispatched: updates.job_dispatched ?? true,
              invoice_available: updates.invoice_available ?? true,
              marketing: updates.marketing ?? false,
              created_at: now,
            });

        if (error) {
          throw new CustomerSettingsError(error.message, 400);
        }
      },
      rollback: async () => {
        if (wasInsert) {
          await adminClient
            .from("contact_notification_preferences")
            .delete()
            .eq("contact_id", context.contact!.id);
          return;
        }

        if (!preferenceSnapshot) {
          return;
        }

        await adminClient
          .from("contact_notification_preferences")
          .update({
            quote_received: preferenceSnapshot.quote_received,
            quote_reminder: preferenceSnapshot.quote_reminder,
            artwork_approval_required: preferenceSnapshot.artwork_approval_required,
            job_started: preferenceSnapshot.job_started,
            job_ready: preferenceSnapshot.job_ready,
            job_dispatched: preferenceSnapshot.job_dispatched,
            invoice_available: preferenceSnapshot.invoice_available,
            marketing: preferenceSnapshot.marketing,
            updated_at: preferenceSnapshot.updated_at,
          })
          .eq("contact_id", context.contact!.id);
      },
      activity: {
        activityType: CRM_ACTIVITY_TYPES.notificationPreferencesUpdated,
        description: `${context.contact.full_name} updated notification preferences.`,
        changedFields,
        contactId: context.contact.id,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Notification preferences updated.",
    });
  } catch (error) {
    return customerSettingsErrorResponse(error);
  }
}
