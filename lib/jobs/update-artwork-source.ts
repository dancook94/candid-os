import type { SupabaseClient } from "@supabase/supabase-js";

import { JOB_ACTIVITY_TYPES, logJobActivity } from "@/lib/jobs/activity";
import {
  getAdminArtworkSourceLabel,
  isJobArtworkSource,
  resolveJobStatusForArtworkSourceChange,
} from "@/lib/jobs/artwork-source";
import { JobError } from "@/lib/jobs/errors";
import { JOB_LIST_COLUMNS } from "@/lib/jobs/job-select";
import { revalidateJobPages } from "@/lib/jobs/revalidation";
import type { JobArtworkSource, JobRecord } from "@/lib/jobs/types";

type UpdateJobArtworkSourceInput = {
  jobId: string;
  artworkSource: string;
  actorProfileId: string;
};

export type UpdateJobArtworkSourceResult = {
  updated: boolean;
  job: JobRecord;
  previousArtworkSource: JobArtworkSource;
  artworkSource: JobArtworkSource;
};

function resolveArtworkSourceActivityType(
  previousSource: JobArtworkSource,
  newSource: JobArtworkSource
) {
  if (previousSource === newSource) {
    return null;
  }

  if (newSource === "manual_receipt") {
    return JOB_ACTIVITY_TYPES.artworkReceivedManually;
  }

  if (newSource === "candid_creating") {
    return JOB_ACTIVITY_TYPES.candidArtworkCreationStarted;
  }

  return JOB_ACTIVITY_TYPES.jobArtworkSourceChanged;
}

export async function updateJobArtworkSource(
  adminClient: SupabaseClient,
  input: UpdateJobArtworkSourceInput
): Promise<UpdateJobArtworkSourceResult> {
  if (!isJobArtworkSource(input.artworkSource)) {
    throw new JobError("Invalid artwork source.", 400);
  }

  const { data: job, error: jobError } = await adminClient
    .from("jobs")
    .select(JOB_LIST_COLUMNS)
    .eq("id", input.jobId)
    .maybeSingle();

  if (jobError) {
    throw new JobError(jobError.message, 500);
  }

  if (!job) {
    throw new JobError("Job not found.", 404);
  }

  const typedJob = job as JobRecord;
  const previousArtworkSource = typedJob.artwork_source;

  if (previousArtworkSource === input.artworkSource) {
    return {
      updated: false,
      job: typedJob,
      previousArtworkSource,
      artworkSource: input.artworkSource,
    };
  }

  const now = new Date().toISOString();
  const nextStatus = resolveJobStatusForArtworkSourceChange(
    typedJob.status,
    input.artworkSource
  );

  const updatePayload: Record<string, unknown> = {
    artwork_source: input.artworkSource,
    updated_at: now,
  };

  if (nextStatus) {
    updatePayload.status = nextStatus;
  }

  const { data: updatedJob, error: updateError } = await adminClient
    .from("jobs")
    .update(updatePayload)
    .eq("id", typedJob.id)
    .select(JOB_LIST_COLUMNS)
    .single();

  if (updateError || !updatedJob) {
    throw new JobError(updateError?.message ?? "Unable to update artwork source.", 500);
  }

  const activityType = resolveArtworkSourceActivityType(
    previousArtworkSource,
    input.artworkSource
  );

  if (activityType) {
    try {
      await logJobActivity(adminClient, {
        activityType,
        description: `Artwork source for ${typedJob.job_reference} changed to ${getAdminArtworkSourceLabel(input.artworkSource)}.`,
        companyId: typedJob.company_id,
        quoteId: typedJob.quote_id,
        opportunityId: typedJob.opportunity_id,
        contactId: typedJob.contact_id,
        actorProfileId: input.actorProfileId,
        metadata: {
          job_id: typedJob.id,
          previous_artwork_source: previousArtworkSource,
          new_artwork_source: input.artworkSource,
          previous_status: typedJob.status,
          new_status: (updatedJob as JobRecord).status,
        },
      });
    } catch {
      // Activity failure must not revert the artwork source update.
    }
  }

  try {
    revalidateJobPages({
      jobId: typedJob.id,
      quoteId: typedJob.quote_id,
      opportunityId: typedJob.opportunity_id,
    });
  } catch {
    // Revalidation failure must not revert the artwork source update.
  }

  return {
    updated: true,
    job: updatedJob as JobRecord,
    previousArtworkSource,
    artworkSource: input.artworkSource,
  };
}

export async function maybeSetPortalUploadArtworkSource(
  adminClient: SupabaseClient,
  jobId: string
) {
  const { data: job, error } = await adminClient
    .from("jobs")
    .select("id, artwork_source")
    .eq("id", jobId)
    .maybeSingle();

  if (error || !job || job.artwork_source !== "customer_pending") {
    return { updated: false as const };
  }

  const now = new Date().toISOString();
  const { error: updateError } = await adminClient
    .from("jobs")
    .update({
      artwork_source: "portal_upload",
      updated_at: now,
    })
    .eq("id", jobId)
    .eq("artwork_source", "customer_pending");

  if (updateError) {
    return { updated: false as const };
  }

  return { updated: true as const };
}
