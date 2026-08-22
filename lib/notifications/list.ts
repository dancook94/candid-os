import type { SupabaseClient } from "@supabase/supabase-js";

import { formatNotificationTypeLabel } from "@/lib/notifications/notification-types";

export type NotificationListFilters = {
  status?: string;
  notificationType?: string;
  audience?: string;
  email?: string;
  failedOnly?: boolean;
  page?: number;
  pageSize?: number;
};

export type NotificationListItem = {
  id: string;
  notificationType: string;
  notificationTypeLabel: string;
  audience: string;
  channel: string;
  status: string;
  intendedRecipientEmail: string | null;
  recipientEmail: string | null;
  subject: string | null;
  provider: string | null;
  providerMessageId: string | null;
  errorMessage: string | null;
  jobId: string | null;
  quoteId: string | null;
  quoteRequestId: string | null;
  companyId: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  createdAt: string;
};

const SELECT = `
  id,
  notification_type,
  audience,
  channel,
  status,
  intended_recipient_email,
  recipient_email,
  subject,
  provider,
  provider_message_id,
  error_message,
  job_id,
  quote_id,
  quote_request_id,
  company_id,
  sent_at,
  delivered_at,
  failed_at,
  created_at
`;

export async function fetchNotificationList(
  adminClient: SupabaseClient,
  filters: NotificationListFilters
) {
  const page = Math.max(filters.page ?? 1, 1);
  const pageSize = Math.min(Math.max(filters.pageSize ?? 50, 1), 100);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = adminClient
    .from("notifications")
    .select(SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (filters.status) {
    query = query.eq("status", filters.status);
  }

  if (filters.notificationType) {
    query = query.eq("notification_type", filters.notificationType);
  }

  if (filters.audience) {
    query = query.eq("audience", filters.audience);
  }

  if (filters.email) {
    query = query.or(
      `recipient_email.ilike.%${filters.email}%,intended_recipient_email.ilike.%${filters.email}%`
    );
  }

  if (filters.failedOnly) {
    query = query.eq("status", "failed");
  }

  const { data, error, count } = await query;

  if (error) {
    if (error.code === "42P01") {
      return {
        items: [] as NotificationListItem[],
        totalCount: 0,
        schemaMissing: true as const,
        error: null,
      };
    }

    return {
      items: [] as NotificationListItem[],
      totalCount: 0,
      schemaMissing: false as const,
      error: error.message,
    };
  }

  const items = (data ?? []).map((row) => ({
    id: row.id as string,
    notificationType: row.notification_type as string,
    notificationTypeLabel: formatNotificationTypeLabel(row.notification_type as string),
    audience: row.audience as string,
    channel: row.channel as string,
    status: row.status as string,
    intendedRecipientEmail: row.intended_recipient_email as string | null,
    recipientEmail: row.recipient_email as string | null,
    subject: row.subject as string | null,
    provider: row.provider as string | null,
    providerMessageId: row.provider_message_id as string | null,
    errorMessage: row.error_message as string | null,
    jobId: row.job_id as string | null,
    quoteId: row.quote_id as string | null,
    quoteRequestId: row.quote_request_id as string | null,
    companyId: row.company_id as string | null,
    sentAt: row.sent_at as string | null,
    deliveredAt: row.delivered_at as string | null,
    failedAt: row.failed_at as string | null,
    createdAt: row.created_at as string,
  }));

  return {
    items,
    totalCount: count ?? 0,
    schemaMissing: false as const,
    error: null,
  };
}

export async function fetchNotificationDetail(
  adminClient: SupabaseClient,
  notificationId: string
) {
  const { data, error } = await adminClient
    .from("notifications")
    .select("*")
    .eq("id", notificationId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}
