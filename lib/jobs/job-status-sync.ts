import type { SupabaseClient } from "@supabase/supabase-js";

import { JobError } from "@/lib/jobs/errors";
import type { JobArtworkStatus, JobRecord } from "@/lib/jobs/types";

export async function syncJobStatusAfterArtworkUpload(
  adminClient: SupabaseClient,
  jobId: string
) {
  const { data: job, error: jobError } = await adminClient
    .from("jobs")
    .select("id, status")
    .eq("id", jobId)
    .maybeSingle();

  if (jobError) {
    throw new JobError(jobError.message, 500);
  }

  if (!job) {
    throw new JobError("Job not found.", 404);
  }

  if (job.status !== "awaiting_artwork") {
    return { updated: false as const, status: job.status };
  }

  const { count, error: fileError } = await adminClient
    .from("job_files")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("upload_status", "complete")
    .is("deleted_at", null);

  if (fileError) {
    throw new JobError(fileError.message, 500);
  }

  if (!count) {
    return { updated: false as const, status: job.status };
  }

  const now = new Date().toISOString();
  const { data: updatedJob, error: updateError } = await adminClient
    .from("jobs")
    .update({
      status: "artwork_uploaded",
      updated_at: now,
    })
    .eq("id", jobId)
    .eq("status", "awaiting_artwork")
    .select("id, status")
    .maybeSingle();

  if (updateError) {
    throw new JobError(updateError.message, 500);
  }

  if (!updatedJob) {
    return { updated: false as const, status: job.status };
  }

  return { updated: true as const, status: updatedJob.status };
}

export async function syncJobStatusAfterArtworkReview(
  adminClient: SupabaseClient,
  job: Pick<JobRecord, "id" | "status">,
  artworkStatus: JobArtworkStatus
) {
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updated_at: now };

  if (
    artworkStatus === "approved" &&
    (job.status === "awaiting_artwork" || job.status === "artwork_uploaded")
  ) {
    updates.status = "in_production";
  }

  await adminClient.from("jobs").update(updates).eq("id", job.id);
}
