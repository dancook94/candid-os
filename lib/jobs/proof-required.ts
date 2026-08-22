import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveJobProofRequired } from "@/lib/notifications/artwork-copy";

export { resolveJobProofRequired as isJobProofRequired };
export async function loadJobProofRequired(
  adminClient: SupabaseClient,
  jobId: string
) {
  const { data, error } = await adminClient
    .from("jobs")
    .select("proof_required")
    .eq("id", jobId)
    .maybeSingle();

  if (error || !data) {
    return true;
  }

  return resolveJobProofRequired(data);
}
