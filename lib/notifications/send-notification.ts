import type { SupabaseClient } from "@supabase/supabase-js";

import { applyEmailModeRedirect } from "@/lib/notifications/email-mode";
import { resolveNotificationReplyTo } from "@/lib/notifications/reply-to";
import { isCustomerEmailEnabled } from "@/lib/notifications/preferences";
import { sendEmailThroughResend } from "@/lib/notifications/resend-client";
import {
  audienceForType,
  isCustomerType,
  isInternalType,
  resolveCustomerRecipient,
  resolveInternalRecipients,
} from "@/lib/notifications/recipient-resolution";
import {
  isCustomerNotificationEnabled,
  isInternalNotificationEnabled,
  resolveInternalRecipientEmails,
} from "@/lib/notifications/settings";
import { loadNotificationSettings } from "@/lib/notifications/settings-store";
import {
  renderNotificationEmail,
  type EmailTemplateContent,
} from "@/lib/notifications/templates";
import type {
  CustomerNotificationType,
  InternalNotificationType,
  NotificationType,
} from "@/lib/notifications/notification-types";

export type SendNotificationInput = {
  type: NotificationType;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  companyId?: string | null;
  contactId?: string | null;
  profileId?: string | null;
  jobId?: string | null;
  quoteId?: string | null;
  quoteRequestId?: string | null;
  opportunityId?: string | null;
  productionItemId?: string | null;
  invoiceDraftId?: string | null;
  /** Override recipient for test sends */
  recipientEmailOverride?: string | null;
};

export type SendNotificationResult = {
  ok: boolean;
  notificationIds: string[];
  results: Array<{
    notificationId: string;
    status: string;
    recipientEmail: string | null;
    intendedRecipientEmail: string | null;
    providerMessageId: string | null;
    error: string | null;
    errorCode: string | null;
    duplicate?: boolean;
  }>;
  skippedReason?: string | null;
  duplicate?: boolean;
};

type NotificationRowInsert = {
  notification_type: string;
  channel: "email";
  audience: string;
  company_id?: string | null;
  contact_id?: string | null;
  profile_id?: string | null;
  job_id?: string | null;
  quote_id?: string | null;
  quote_request_id?: string | null;
  opportunity_id?: string | null;
  production_item_id?: string | null;
  invoice_draft_id?: string | null;
  recipient_email?: string | null;
  intended_recipient_email?: string | null;
  subject?: string | null;
  template_key?: string | null;
  status: string;
  provider?: string | null;
  provider_message_id?: string | null;
  error_message?: string | null;
  metadata?: Record<string, unknown>;
  idempotency_key?: string | null;
  sent_at?: string | null;
  failed_at?: string | null;
};

async function findExistingByIdempotencyKey(
  adminClient: SupabaseClient,
  idempotencyKey: string
) {
  const { data, error } = await adminClient
    .from("notifications")
    .select("id, status, recipient_email, intended_recipient_email, provider_message_id, error_message")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01") {
      return null;
    }

    throw error;
  }

  return data;
}

async function insertNotification(
  adminClient: SupabaseClient,
  row: NotificationRowInsert
) {
  const { data, error } = await adminClient
    .from("notifications")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    if (error.code === "42P01") {
      throw new Error("notifications_schema_missing");
    }

    throw error;
  }

  return data.id as string;
}

async function recordNotificationIssue(
  adminClient: SupabaseClient,
  input: SendNotificationInput,
  issue: {
    status: "failed" | "suppressed";
    reason: string;
    intendedRecipient?: string | null;
  }
) {
  try {
    const rendered = renderNotificationEmail(input.type, input.metadata ?? {});
    const audience = audienceForType(input.type);
    const now = new Date().toISOString();
    const intendedRecipient = issue.intendedRecipient ?? null;

    const row: NotificationRowInsert = {
      ...buildBaseRow(input, audience, intendedRecipient ?? "unknown", rendered.subject),
      intended_recipient_email: intendedRecipient,
      status: issue.status,
      error_message: issue.reason,
      failed_at: issue.status === "failed" ? now : null,
      metadata: {
        ...(input.metadata ?? {}),
        skipReason: issue.reason,
      },
    };

    return await insertNotification(adminClient, row);
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("[notifications] failed to record notification issue", {
        type: input.type,
        reason: issue.reason,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return null;
  }
}

async function updateNotification(
  adminClient: SupabaseClient,
  notificationId: string,
  update: Partial<NotificationRowInsert> & { updated_at?: string }
) {
  const { error } = await adminClient
    .from("notifications")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", notificationId);

  if (error) {
    throw error;
  }
}

function buildBaseRow(
  input: SendNotificationInput,
  audience: string,
  intendedRecipient: string,
  subject: string
): NotificationRowInsert {
  return {
    notification_type: input.type,
    channel: "email",
    audience,
    company_id: input.companyId ?? null,
    contact_id: input.contactId ?? null,
    profile_id: input.profileId ?? null,
    job_id: input.jobId ?? null,
    quote_id: input.quoteId ?? null,
    quote_request_id: input.quoteRequestId ?? null,
    opportunity_id: input.opportunityId ?? null,
    production_item_id: input.productionItemId ?? null,
    invoice_draft_id: input.invoiceDraftId ?? null,
    recipient_email: null,
    intended_recipient_email: intendedRecipient,
    subject,
    template_key: input.type,
    status: "pending",
    provider: "resend",
    metadata: {
      ...(input.metadata ?? {}),
      emailMode: applyEmailModeRedirect({ intendedRecipient, subject }).mode,
    },
    idempotency_key: input.idempotencyKey ?? null,
  };
}

async function deliverEmailNotification(
  adminClient: SupabaseClient,
  input: SendNotificationInput,
  intendedRecipient: string,
  idempotencySuffix?: string
) {
  const rendered = renderNotificationEmail(input.type, input.metadata ?? {});
  const audience = audienceForType(input.type);
  const idempotencyKey = input.idempotencyKey
    ? idempotencySuffix
      ? `${input.idempotencyKey}:${idempotencySuffix}`
      : input.idempotencyKey
    : null;

  if (idempotencyKey) {
    const existing = await findExistingByIdempotencyKey(adminClient, idempotencyKey);

    if (existing) {
      return {
        notificationId: existing.id as string,
        status: existing.status as string,
        recipientEmail: existing.recipient_email as string | null,
        intendedRecipientEmail: existing.intended_recipient_email as string | null,
        providerMessageId: existing.provider_message_id as string | null,
        error: existing.error_message as string | null,
        errorCode: null,
        duplicate: true,
      };
    }
  }

  const notificationId = await insertNotification(
    adminClient,
    buildBaseRow(input, audience, intendedRecipient, rendered.subject)
  );

  const sendResult = await sendEmailThroughResend({
    intendedRecipient,
    subject: rendered.subject,
    html: rendered.html,
    replyTo: resolveNotificationReplyTo(input.type),
  });

  const now = new Date().toISOString();

  if (sendResult.ok) {
    const status =
      sendResult.status === "suppressed" || sendResult.status === "skipped"
        ? "suppressed"
        : "sent";

    await updateNotification(adminClient, notificationId, {
      status,
      recipient_email: sendResult.actualRecipient,
      intended_recipient_email: sendResult.intendedRecipient,
      provider_message_id: sendResult.providerMessageId,
      sent_at: status === "sent" ? now : null,
      metadata: {
        ...(input.metadata ?? {}),
        redirected: sendResult.redirected,
        reason: sendResult.reason ?? null,
      },
    });

    return {
      notificationId,
      status,
      recipientEmail: sendResult.actualRecipient,
      intendedRecipientEmail: sendResult.intendedRecipient,
      providerMessageId: sendResult.providerMessageId,
      error: null,
      errorCode: sendResult.reason ?? null,
      duplicate: false,
    };
  }

  await updateNotification(adminClient, notificationId, {
    status: "failed",
    recipient_email: sendResult.actualRecipient ?? null,
    intended_recipient_email: sendResult.intendedRecipient,
    error_message: sendResult.error,
    failed_at: now,
    metadata: {
      ...(input.metadata ?? {}),
      errorCode: sendResult.errorCode,
    },
  });

  return {
    notificationId,
    status: "failed",
    recipientEmail: sendResult.actualRecipient ?? null,
    intendedRecipientEmail: sendResult.intendedRecipient,
    providerMessageId: null,
    error: sendResult.error,
    errorCode: sendResult.errorCode,
    duplicate: false,
  };
}

export async function sendNotification(
  adminClient: SupabaseClient,
  input: SendNotificationInput
): Promise<SendNotificationResult> {
  try {
    const settings = await loadNotificationSettings(adminClient);

    if (input.recipientEmailOverride) {
      const rendered = renderNotificationEmail(input.type, input.metadata ?? {});
      const result = await deliverEmailNotification(
        adminClient,
        input,
        input.recipientEmailOverride
      );

      return {
        ok: result.status !== "failed",
        notificationIds: [result.notificationId],
        results: [result],
      };
    }

    if (isCustomerType(input.type)) {
      if (!isCustomerNotificationEnabled(settings, input.type)) {
        const notificationId = await recordNotificationIssue(adminClient, input, {
          status: "suppressed",
          reason: "suppressed_by_admin_setting",
        });

        return {
          ok: true,
          notificationIds: notificationId ? [notificationId] : [],
          results: [],
          skippedReason: "suppressed_by_admin_setting",
        };
      }

      const preference = await isCustomerEmailEnabled(adminClient, {
        contactId: input.contactId,
        notificationType: input.type,
      });

      if (!preference.enabled) {
        const notificationId = await recordNotificationIssue(adminClient, input, {
          status: "suppressed",
          reason: preference.reason ?? "suppressed_by_preference",
        });

        return {
          ok: true,
          notificationIds: notificationId ? [notificationId] : [],
          results: [],
          skippedReason: preference.reason,
        };
      }

      const recipient = await resolveCustomerRecipient(adminClient, {
        contactId: input.contactId,
        companyId: input.companyId,
        profileId: input.profileId,
      });

      if (!recipient) {
        const notificationId = await recordNotificationIssue(adminClient, input, {
          status: "failed",
          reason: "missing_recipient",
        });

        return {
          ok: false,
          notificationIds: notificationId ? [notificationId] : [],
          results: [],
          skippedReason: "missing_recipient",
        };
      }

      const result = await deliverEmailNotification(
        adminClient,
        input,
        recipient.email
      );

      return {
        ok: result.status !== "failed",
        notificationIds: [result.notificationId],
        results: [result],
        duplicate: result.duplicate,
      };
    }

    if (isInternalType(input.type)) {
      if (!isInternalNotificationEnabled(settings, input.type)) {
        const notificationId = await recordNotificationIssue(adminClient, input, {
          status: "suppressed",
          reason: "suppressed_by_admin_setting",
        });

        return {
          ok: true,
          notificationIds: notificationId ? [notificationId] : [],
          results: [],
          skippedReason: "suppressed_by_admin_setting",
        };
      }

      const emails = resolveInternalRecipients(
        resolveInternalRecipientEmails(settings, input.type)
      );

      if (emails.length === 0) {
        const notificationId = await recordNotificationIssue(adminClient, input, {
          status: "failed",
          reason: "missing_internal_recipients",
        });

        return {
          ok: false,
          notificationIds: notificationId ? [notificationId] : [],
          results: [],
          skippedReason: "missing_internal_recipients",
        };
      }

      const results = [];

      for (const email of emails) {
        const result = await deliverEmailNotification(
          adminClient,
          input,
          email,
          email
        );
        results.push(result);
      }

      return {
        ok: results.every((result) => result.status !== "failed"),
        notificationIds: results.map((result) => result.notificationId),
        results,
      };
    }

    return {
      ok: false,
      notificationIds: [],
      results: [],
      skippedReason: "unsupported_notification_type",
    };
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("[notifications] sendNotification failed", {
        type: input.type,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      ok: false,
      notificationIds: [],
      results: [],
      skippedReason: error instanceof Error ? error.message : "notification_failed",
    };
  }
}

export async function retryFailedNotification(
  adminClient: SupabaseClient,
  notificationId: string
) {
  const { data, error } = await adminClient
    .from("notifications")
    .select("*")
    .eq("id", notificationId)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Notification not found.");
  }

  if (data.status !== "failed") {
    throw new Error("Only failed notifications can be retried.");
  }

  const rendered = renderNotificationEmail(
    data.notification_type as NotificationType,
    (data.metadata as Record<string, unknown>) ?? {}
  );

  const intendedRecipient =
    (data.intended_recipient_email as string | null) ??
    (data.recipient_email as string | null);

  if (!intendedRecipient) {
    throw new Error("Notification has no recipient.");
  }

  await updateNotification(adminClient, notificationId, {
    status: "sending",
    error_message: null,
    failed_at: null,
  });

  const sendResult = await sendEmailThroughResend({
    intendedRecipient,
    subject: rendered.subject,
    html: rendered.html,
    replyTo: resolveNotificationReplyTo(data.notification_type as NotificationType),
  });

  const now = new Date().toISOString();

  if (sendResult.ok) {
    const status =
      sendResult.status === "suppressed" || sendResult.status === "skipped"
        ? "suppressed"
        : "sent";

    await updateNotification(adminClient, notificationId, {
      status,
      recipient_email: sendResult.actualRecipient,
      provider_message_id: sendResult.providerMessageId,
      sent_at: status === "sent" ? now : null,
    });

    return {
      ok: true,
      status,
      providerMessageId: sendResult.providerMessageId,
    };
  }

  await updateNotification(adminClient, notificationId, {
    status: "failed",
    error_message: sendResult.error,
    failed_at: now,
  });

  return {
    ok: false,
    status: "failed",
    error: sendResult.error,
    errorCode: sendResult.errorCode,
  };
}

export type { EmailTemplateContent };
