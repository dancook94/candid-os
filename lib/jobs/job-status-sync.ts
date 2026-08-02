import type { SupabaseClient } from "@supabase/supabase-js";

import { JOB_ACTIVITY_TYPES, logJobActivity } from "@/lib/jobs/activity";
import { JobError } from "@/lib/jobs/errors";
import { JOB_STATUS_LABELS } from "@/lib/jobs/constants";
import { resolveJobStatusAfterPortalUpload } from "@/lib/jobs/job-status-workflow";
import type { JobArtworkStatus, JobRecord, JobStatus } from "@/lib/jobs/types";

const ARTWORK_RECEIVED_STATUSES: JobStatus[] = [
  "awaiting_artwork",
  "artwork_in_preparation",
  "artwork_received",
];

export async function syncJobStatusAfterArtworkUpload(
  adminClient: SupabaseClient,
  jobId: string,
  options: { actorProfileId?: string | null } = {}
) {
  const { data: job, error: jobError } = await adminClient
    .from("jobs")
    .select("id, status, company_id, quote_id, opportunity_id, contact_id, job_reference")
    .eq("id", jobId)
    .maybeSingle();

  if (jobError) {
    throw new JobError(jobError.message, 500);
  }

  if (!job) {
    throw new JobError("Job not found.", 404);
  }

  const nextStatus = resolveJobStatusAfterPortalUpload(job.status as JobStatus);

  if (!nextStatus) {
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
      status: nextStatus,
      updated_at: now,
    })
    .eq("id", jobId)
    .eq("status", job.status)
    .select("id, status")
    .maybeSingle();

  if (updateError) {
    throw new JobError(updateError.message, 500);
  }

  if (!updatedJob) {
    return { updated: false as const, status: job.status };
  }

  try {
    await logJobActivity(adminClient, {
      activityType: JOB_ACTIVITY_TYPES.jobStatusChanged,
      description: `Job ${job.job_reference} status changed to ${JOB_STATUS_LABELS[nextStatus] ?? nextStatus}.`,
      companyId: job.company_id,
      quoteId: job.quote_id,
      opportunityId: job.opportunity_id,
      contactId: job.contact_id,
      actorProfileId: options.actorProfileId ?? null,
      metadata: {
        job_id: jobId,
        previous_status: job.status,
        new_status: nextStatus,
        trigger: "portal_upload",
      },
    });
  } catch {
    // Non-critical.
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
    ARTWORK_RECEIVED_STATUSES.includes(job.status)
  ) {
    updates.status = "in_production";
  }

  await adminClient.from("jobs").update(updates).eq("id", job.id);
}
