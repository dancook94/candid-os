import type { SupabaseClient } from "@supabase/supabase-js";

import {
  notifyArtworkUploadedSafe,
  notifyQuoteAcceptedSafe,
} from "@/lib/notifications/triggers";

export async function prepareQuoteAcceptedNotification(input: {
  adminClient: SupabaseClient;
  companyId: string;
  quoteId: string;
  jobId: string;
  contactId?: string | null;
  opportunityId?: string | null;
}) {
  await notifyQuoteAcceptedSafe(input.adminClient, {
    companyId: input.companyId,
    quoteId: input.quoteId,
    jobId: input.jobId,
    contactId: input.contactId,
    opportunityId: input.opportunityId,
  });
}

export function prepareJobCreatedNotification(_input: {
  companyId: string;
  quoteId: string;
  jobId: string;
  jobReference: string;
}) {
  // Reserved for a future job-created notification type.
}

export function prepareArtworkRequestedNotification(_input: {
  companyId: string;
  jobId: string;
  jobReference: string;
}) {
  // Reserved for a future artwork-requested notification type.
}

export async function prepareArtworkUploadedNotification(input: {
  adminClient: SupabaseClient;
  companyId: string;
  jobId: string;
  fileId: string;
}) {
  await notifyArtworkUploadedSafe(input.adminClient, {
    companyId: input.companyId,
    jobId: input.jobId,
    fileId: input.fileId,
  });
}
