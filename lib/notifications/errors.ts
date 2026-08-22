type PostgrestLikeError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

const NOTIFICATIONS_MIGRATION =
  "supabase/migrations/20260822100000_notifications_phase1.sql";

export function getNotificationErrorDetails(error: unknown) {
  if (!error || typeof error !== "object") {
    return {
      code: null as string | null,
      message: String(error),
      details: null as string | null,
      hint: null as string | null,
    };
  }

  const postgrestError = error as PostgrestLikeError;

  return {
    code: postgrestError.code ?? null,
    message: postgrestError.message ?? "Unknown notification error",
    details: postgrestError.details ?? null,
    hint: postgrestError.hint ?? null,
  };
}

export function isNotificationsSchemaMissingError(error: unknown) {
  const { code, message } = getNotificationErrorDetails(error);

  if (code === "42P01" || code === "PGRST205") {
    return true;
  }

  return (
    message.includes("notifications_schema_missing") ||
    message.includes("Could not find the table 'public.notifications'") ||
    message.includes("Could not find the table 'public.notification_settings'") ||
    message.includes("Could not find the table 'public.notification_preferences'")
  );
}

export function toAdminSafeNotificationFailureReason(error: unknown) {
  const { code, message } = getNotificationErrorDetails(error);

  if (isNotificationsSchemaMissingError(error)) {
    return {
      reason: "notification_table_unavailable",
      message: `Notification tables are not deployed in Supabase. Apply ${NOTIFICATIONS_MIGRATION}.`,
      code,
    };
  }

  if (message.includes("missing_recipient") || message.includes("Recipient could not")) {
    return {
      reason: "recipient_unresolved",
      message: "Recipient could not be resolved for this customer.",
      code,
    };
  }

  if (message.includes("missing_test_recipient") || message.includes("EMAIL_TEST_RECIPIENT")) {
    return {
      reason: "test_recipient_missing",
      message: "EMAIL_MODE=test requires EMAIL_TEST_RECIPIENT.",
      code,
    };
  }

  if (message.includes("resend_not_configured") || message.includes("Resend is not configured")) {
    return {
      reason: "resend_not_configured",
      message: "Resend is not configured for outbound notifications.",
      code,
    };
  }

  if (message.includes("provider_rejection")) {
    return {
      reason: "resend_rejected",
      message: message,
      code,
    };
  }

  if (message.includes("suppressed_by_admin_setting")) {
    return {
      reason: "suppressed_by_settings",
      message: "Notification suppressed by admin notification settings.",
      code,
    };
  }

  if (message.includes("Email template") || message.includes("template")) {
    return {
      reason: "template_error",
      message: "Email template could not be rendered.",
      code,
    };
  }

  return {
    reason: "notification_failed",
    message: message || "Notification delivery failed.",
    code,
  };
}

export function getSkippedReasonLabel(skippedReason: string | null | undefined) {
  if (!skippedReason) {
    return null;
  }

  switch (skippedReason) {
    case "notification_table_unavailable":
      return `Notification tables are not deployed in Supabase. Apply ${NOTIFICATIONS_MIGRATION}.`;
    case "missing_recipient":
      return "Recipient could not be resolved for this customer.";
    case "missing_internal_recipients":
      return "No internal notification recipients are configured.";
    case "suppressed_by_admin_setting":
      return "Notification suppressed by admin notification settings.";
    case "missing_test_recipient":
      return "EMAIL_MODE=test requires EMAIL_TEST_RECIPIENT.";
    case "resend_not_configured":
      return "Resend is not configured for outbound notifications.";
    case "recipient_unresolved":
      return "Recipient could not be resolved for this customer.";
    case "test_recipient_missing":
      return "EMAIL_MODE=test requires EMAIL_TEST_RECIPIENT.";
    case "suppressed_by_settings":
      return "Notification suppressed by admin notification settings.";
    default:
      return skippedReason;
  }
}
