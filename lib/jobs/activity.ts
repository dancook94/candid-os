import type { SupabaseClient } from "@supabase/supabase-js";

import { createCrmActivity } from "@/lib/crm/create-crm-activity";
import { JOB_ACTIVITY_TYPES } from "@/lib/jobs/constants";

type JobActivityInput = {
  activityType: string;
  description: string;
  companyId: string;
  quoteId?: string | null;
  opportunityId?: string | null;
  contactId?: string | null;
  actorProfileId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function logJobActivity(
  adminClient: SupabaseClient,
  input: JobActivityInput
) {
  await createCrmActivity(adminClient, {
    companyId: input.companyId,
    contactId: input.contactId ?? null,
    opportunityId: input.opportunityId ?? null,
    quoteId: input.quoteId ?? null,
    activityType: input.activityType,
    description: input.description,
    actorProfileId: input.actorProfileId ?? null,
    metadata: input.metadata,
    validatedLinks: {
      companyId: input.companyId,
      contactId: input.contactId ?? null,
      opportunityId: input.opportunityId ?? null,
      quoteId: input.quoteId ?? null,
      taskId: null,
    },
  });
}

export { JOB_ACTIVITY_TYPES };

export function prepareArtworkUploadedNotification(_input: {
  companyId: string;
  jobId: string;
  fileId: string;
}) {
  // Implemented in lib/jobs/notifications.ts — kept for backwards compatibility.
}

export function prepareArtworkChangesRequestedNotification(_input: {
  companyId: string;
  jobId: string;
  fileId: string;
}) {
  // Hook for future SMTP notifications.
}

export function prepareArtworkApprovedNotification(_input: {
  companyId: string;
  jobId: string;
  fileId: string;
}) {
  // Hook for future SMTP notifications.
}
