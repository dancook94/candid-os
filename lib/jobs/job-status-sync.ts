import type { SupabaseClient } from "@supabase/supabase-js";

import type { JobArtworkStatus, JobRecord } from "@/lib/jobs/types";

export async function syncJobStatusAfterArtworkUpload(
  adminClient: SupabaseClient,
  jobId: string
) {
  const now = new Date().toISOString();

  await adminClient
    .from("jobs")
    .update({ updated_at: now })
    .eq("id", jobId)
    .eq("status", "awaiting_artwork");
}

export async function syncJobStatusAfterArtworkReview(
  adminClient: SupabaseClient,
  job: Pick<JobRecord, "id" | "status">,
  artworkStatus: JobArtworkStatus
) {
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updated_at: now };

  if (artworkStatus === "approved" && job.status === "awaiting_artwork") {
    updates.status = "in_production";
  }

  await adminClient.from("jobs").update(updates).eq("id", job.id);
}
