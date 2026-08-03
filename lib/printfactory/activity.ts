import type { SupabaseClient } from "@supabase/supabase-js";

import { createCrmActivity } from "@/lib/crm/create-crm-activity";
import { PRINTFACTORY_ACTIVITY_TYPES } from "@/lib/printfactory/constants";

type PrintfactoryActivityInput = {
  activityType: string;
  description: string;
  companyId?: string | null;
  quoteId?: string | null;
  jobId?: string | null;
  opportunityId?: string | null;
  contactId?: string | null;
  actorProfileId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function logPrintfactoryActivity(
  adminClient: SupabaseClient,
  input: PrintfactoryActivityInput
) {
  if (!input.companyId) {
    return;
  }

  await createCrmActivity(adminClient, {
    companyId: input.companyId,
    contactId: input.contactId ?? null,
    opportunityId: input.opportunityId ?? null,
    quoteId: input.quoteId ?? null,
    activityType: input.activityType,
    description: input.description,
    actorProfileId: input.actorProfileId ?? null,
    metadata: {
      ...input.metadata,
      job_id: input.jobId ?? null,
      internal_only: true,
    },
    validatedLinks: {
      companyId: input.companyId,
      contactId: input.contactId ?? null,
      opportunityId: input.opportunityId ?? null,
      quoteId: input.quoteId ?? null,
      taskId: null,
    },
  });
}

export { PRINTFACTORY_ACTIVITY_TYPES };
