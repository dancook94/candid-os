import type { SupabaseClient } from "@supabase/supabase-js";

import {
  JOB_BOARD_ACTIVITY_TYPES,
} from "@/lib/production/job-board-constants";
import { logPrintfactoryActivity } from "@/lib/printfactory/activity";
import { PRINTFACTORY_ACTIVITY_TYPES } from "@/lib/printfactory/constants";

export async function archiveOpportunityForProduction(
  adminClient: SupabaseClient,
  opportunityId: string | null,
  actorProfileId: string | null
): Promise<{ archived: boolean; warning: string | null }> {
  if (!opportunityId) {
    return { archived: false, warning: null };
  }

  const { data: opportunity, error: loadError } = await adminClient
    .from("opportunities")
    .select("id, stage, archived_at, company_id, owner_profile_id")
    .eq("id", opportunityId)
    .maybeSingle();

  if (loadError) {
    if (loadError.code === "42703") {
      return {
        archived: false,
        warning: "Opportunity archive columns missing. Apply Phase 2 migration.",
      };
    }

    return {
      archived: false,
      warning: loadError.message,
    };
  }

  if (!opportunity) {
    return { archived: false, warning: "Linked opportunity not found." };
  }

  if (opportunity.archived_at) {
    return { archived: false, warning: null };
  }

  const now = new Date().toISOString();

  const { error: updateError } = await adminClient
    .from("opportunities")
    .update({
      archived_at: now,
      archived_by_profile_id: actorProfileId,
      archived_reason: "moved_to_production",
    })
    .eq("id", opportunityId)
    .is("archived_at", null);

  if (updateError) {
    return {
      archived: false,
      warning: updateError.message,
    };
  }

  await logPrintfactoryActivity(adminClient, {
    activityType: "opportunity_archived_for_production",
    description: "Linked won opportunity archived after job reached Ready to Print.",
    companyId: opportunity.company_id as string,
    opportunityId,
    actorProfileId,
    metadata: {
      archived_reason: "moved_to_production",
    },
  });

  return { archived: true, warning: null };
}

export { PRINTFACTORY_ACTIVITY_TYPES, JOB_BOARD_ACTIVITY_TYPES };
