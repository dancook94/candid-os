import type { SupabaseClient } from "@supabase/supabase-js";

import { logJobActivity } from "@/lib/jobs/activity";
import { PROOF_ACTIVITY_TYPES } from "@/lib/proofs/constants";

type ProofActivityInput = {
  activityType: string;
  description: string;
  companyId: string;
  quoteId: string;
  opportunityId?: string | null;
  actorProfileId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function logProofActivity(
  adminClient: SupabaseClient,
  input: ProofActivityInput
) {
  await logJobActivity(adminClient, input);
}

export { PROOF_ACTIVITY_TYPES };
