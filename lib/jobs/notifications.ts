import type { SupabaseClient } from "@supabase/supabase-js";

import {
  notifyArtworkReceivedManuallySafe,
  notifyCandidCreatingArtworkSafe,
  notifyCustomerArtworkReceivedSafe,
  notifyQuoteAcceptedSafe,
} from "@/lib/notifications/triggers";
import { provisionJobSlackChannelSafe } from "@/lib/slack/job-service";

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

export async function prepareJobCreatedNotification(input: {
  adminClient: SupabaseClient;
  companyId: string;
  quoteId: string;
  jobId: string;
  jobReference: string;
}) {
  await provisionJobSlackChannelSafe(input.adminClient, {
    jobId: input.jobId,
    companyId: input.companyId,
    quoteId: input.quoteId,
  });
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
  await notifyCustomerArtworkReceivedSafe(input.adminClient, {
    companyId: input.companyId,
    jobId: input.jobId,
    fileId: input.fileId,
  });
}

export async function prepareArtworkReceivedManuallyNotification(input: {
  adminClient: SupabaseClient;
  jobId: string;
}) {
  await notifyArtworkReceivedManuallySafe(input.adminClient, {
    jobId: input.jobId,
  });
}

export async function prepareCandidCreatingArtworkNotification(input: {
  adminClient: SupabaseClient;
  jobId: string;
}) {
  await notifyCandidCreatingArtworkSafe(input.adminClient, {
    jobId: input.jobId,
  });
}
