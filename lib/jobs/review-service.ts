import {
  JOB_ACTIVITY_TYPES,
  logJobActivity,
  prepareArtworkApprovedNotification,
  prepareArtworkChangesRequestedNotification,
} from "@/lib/jobs/activity";
import { JobError } from "@/lib/jobs/errors";
import type { JobArtworkStatus } from "@/lib/jobs/types";
import { createAdminClient } from "@/lib/supabase/admin";

export async function updateArtworkReviewStatus({
  jobId,
  fileId,
  artworkStatus,
  actorProfileId,
  changesRequiredComment,
  internalNotes,
}: {
  jobId: string;
  fileId: string;
  artworkStatus: JobArtworkStatus;
  actorProfileId: string;
  changesRequiredComment?: string | null;
  internalNotes?: string | null;
}) {
  const adminClient = createAdminClient();

  const { data: file, error: fileError } = await adminClient
    .from("job_files")
    .select("*")
    .eq("id", fileId)
    .eq("job_id", jobId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fileError || !file) {
    throw new JobError("Artwork file not found.", 404);
  }

  const { data: job, error: jobError } = await adminClient
    .from("jobs")
    .select("id, company_id, quote_id, opportunity_id, job_reference")
    .eq("id", jobId)
    .maybeSingle();

  if (jobError || !job) {
    throw new JobError("Job not found.", 404);
  }

  if (file.upload_status !== "complete") {
    throw new JobError("Only completed uploads can be reviewed.", 409);
  }

  if (artworkStatus === "changes_required") {
    const comment = changesRequiredComment?.trim();
    if (!comment) {
      throw new JobError("A customer-facing comment is required when requesting changes.", 400);
    }
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    artwork_status: artworkStatus,
    internal_notes: internalNotes?.trim() || file.internal_notes,
    changes_required_comment:
      artworkStatus === "changes_required"
        ? changesRequiredComment?.trim() || null
        : file.changes_required_comment,
    reviewed_at:
      artworkStatus === "under_review" || artworkStatus === "changes_required"
        ? now
        : file.reviewed_at,
    approved_at: artworkStatus === "approved" ? now : file.approved_at,
    approved_by_profile_id:
      artworkStatus === "approved" ? actorProfileId : file.approved_by_profile_id,
  };

  const { error: updateError } = await adminClient
    .from("job_files")
    .update(updates)
    .eq("id", fileId);

  if (updateError) {
    throw new JobError(updateError.message, 500);
  }

  let activityType: string = JOB_ACTIVITY_TYPES.artworkReviewStarted;
  let description = `Artwork review started for ${job.job_reference}.`;

  if (artworkStatus === "changes_required") {
    activityType = JOB_ACTIVITY_TYPES.artworkChangesRequested;
    description = `Changes were requested for artwork on ${job.job_reference}.`;
    prepareArtworkChangesRequestedNotification({
      companyId: job.company_id,
      jobId: job.id,
      fileId,
    });
  } else if (artworkStatus === "approved") {
    activityType = JOB_ACTIVITY_TYPES.artworkApproved;
    description = `Artwork was approved for ${job.job_reference}.`;
    prepareArtworkApprovedNotification({
      companyId: job.company_id,
      jobId: job.id,
      fileId,
    });
  }

  await logJobActivity(adminClient, {
    activityType,
    description,
    companyId: job.company_id,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
    actorProfileId,
    metadata: {
      job_id: job.id,
      job_file_id: fileId,
      artwork_status: artworkStatus,
      version_number: file.version_number,
    },
  });
}
