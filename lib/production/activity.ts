import type { SupabaseClient } from "@supabase/supabase-js";

import { createCrmActivity } from "@/lib/crm/create-crm-activity";
import { PRODUCTION_ACTIVITY_TYPES } from "@/lib/production/constants";
import type { ProductionStatus } from "@/lib/production/constants";

type ProductionActivityInput = {
  activityType: string;
  description: string;
  companyId: string;
  quoteId: string;
  jobId: string;
  productionItemId: string;
  opportunityId?: string | null;
  contactId?: string | null;
  actorProfileId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function logProductionActivity(
  adminClient: SupabaseClient,
  input: ProductionActivityInput
) {
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
      production_item_id: input.productionItemId,
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

export function buildStageChangedDescription(input: {
  itemName: string;
  jobReference: string;
  previousStage: ProductionStatus;
  newStage: ProductionStatus;
  previousLabel: string;
  newLabel: string;
}) {
  return `Production item "${input.itemName}" on ${input.jobReference} moved from ${input.previousLabel} to ${input.newLabel}.`;
}

export { PRODUCTION_ACTIVITY_TYPES };
