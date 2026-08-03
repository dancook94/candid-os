import type { SupabaseClient } from "@supabase/supabase-js";

import { createCrmActivity } from "@/lib/crm/create-crm-activity";
import { MANIFEST_ACTIVITY_TYPES } from "@/lib/manifest/constants";

type ManifestActivityInput = {
  activityType: string;
  description: string;
  companyId: string;
  quoteId?: string | null;
  jobId: string;
  productionItemId?: string | null;
  opportunityId?: string | null;
  contactId?: string | null;
  actorProfileId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function logManifestActivity(
  adminClient: SupabaseClient,
  input: ManifestActivityInput
) {
  if (!input.quoteId) {
    return;
  }

  await createCrmActivity(adminClient, {
    companyId: input.companyId,
    contactId: input.contactId ?? null,
    opportunityId: input.opportunityId ?? null,
    quoteId: input.quoteId,
    activityType: input.activityType,
    description: input.description,
    actorProfileId: input.actorProfileId ?? null,
    metadata: {
      ...input.metadata,
      job_id: input.jobId,
      production_item_id: input.productionItemId ?? null,
      internal_only: true,
    },
    validatedLinks: {
      companyId: input.companyId,
      contactId: input.contactId ?? null,
      opportunityId: input.opportunityId ?? null,
      quoteId: input.quoteId,
      taskId: null,
    },
  });
}

export { MANIFEST_ACTIVITY_TYPES };
