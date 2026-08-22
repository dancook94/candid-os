import type { SupabaseClient } from "@supabase/supabase-js";

import { JOB_ACTIVITY_TYPES, logJobActivity } from "@/lib/jobs/activity";
import {
  getAdminArtworkSourceLabel,
  isJobArtworkSource,
  shouldAutoSetPortalUploadSource,
} from "@/lib/jobs/artwork-source";
import { JobError } from "@/lib/jobs/errors";
import {
  prepareArtworkReceivedManuallyNotification,
  prepareCandidCreatingArtworkNotification,
} from "@/lib/jobs/notifications";
import {
  resolveJobStatusForArtworkSourceChange,
  resolveJobStatusAfterPortalUpload,
} from "@/lib/jobs/job-status-workflow";
import { JOB_LIST_COLUMNS } from "@/lib/jobs/job-select";
import { JOB_STATUS_LABELS } from "@/lib/jobs/constants";
import { revalidateJobPages } from "@/lib/jobs/revalidation";
import type { JobArtworkSource, JobRecord, JobStatus } from "@/lib/jobs/types";

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

function resolveArtworkSourceActivityDescription(
  jobReference: string,
  newSource: JobArtworkSource
) {
  switch (newSource) {
    case "manual_receipt":
      return `Artwork marked as received manually for ${jobReference}.`;
    case "candid_creating":
      return `Candid preparing artwork for ${jobReference}.`;
    default:
      return `Artwork source for ${jobReference} changed to ${getAdminArtworkSourceLabel(newSource)}.`;
  }
}

async function logJobStatusChangedActivity(
  adminClient: SupabaseClient,
  job: JobRecord,
  input: {
    actorProfileId: string | null;
    previousStatus: JobStatus;
    newStatus: JobStatus;
    trigger: string;
  }
) {
  if (input.previousStatus === input.newStatus) {
    return;
  }

  await logJobActivity(adminClient, {
    activityType: JOB_ACTIVITY_TYPES.jobStatusChanged,
    description: `Job ${job.job_reference} status changed to ${JOB_STATUS_LABELS[input.newStatus] ?? input.newStatus}.`,
    companyId: job.company_id,
    quoteId: job.quote_id,
    opportunityId: job.opportunity_id,
    contactId: job.contact_id,
    actorProfileId: input.actorProfileId,
    metadata: {
      job_id: job.id,
      previous_status: input.previousStatus,
      new_status: input.newStatus,
      trigger: input.trigger,
    },
  });
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

  if (nextStatus && nextStatus !== typedJob.status) {
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

  const updatedTypedJob = updatedJob as JobRecord;
  const activityType = resolveArtworkSourceActivityType(
    previousArtworkSource,
    input.artworkSource
  );

  try {
    if (activityType) {
      await logJobActivity(adminClient, {
        activityType,
        description: resolveArtworkSourceActivityDescription(
          typedJob.job_reference,
          input.artworkSource
        ),
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
          new_status: updatedTypedJob.status,
        },
      });
    }

    if (nextStatus && nextStatus !== typedJob.status) {
      await logJobStatusChangedActivity(adminClient, typedJob, {
        actorProfileId: input.actorProfileId,
        previousStatus: typedJob.status,
        newStatus: nextStatus,
        trigger: "artwork_source_change",
      });
    }
  } catch {
    // Activity failure must not revert the artwork source update.
  }

  try {
    if (input.artworkSource === "manual_receipt") {
      await prepareArtworkReceivedManuallyNotification({
        adminClient,
        jobId: typedJob.id,
      });
    } else if (input.artworkSource === "candid_creating") {
      await prepareCandidCreatingArtworkNotification({
        adminClient,
        jobId: typedJob.id,
      });
    }
  } catch {
    // Notification failure must not revert the artwork source update.
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
    job: updatedTypedJob,
    previousArtworkSource,
    artworkSource: input.artworkSource,
  };
}

export async function syncJobAfterPortalUpload(
  adminClient: SupabaseClient,
  jobId: string,
  options: { actorProfileId?: string | null } = {}
) {
  const { data: job, error } = await adminClient
    .from("jobs")
    .select(JOB_LIST_COLUMNS)
    .eq("id", jobId)
    .maybeSingle();

  if (error || !job) {
    return { updated: false as const };
  }

  const typedJob = job as JobRecord;
  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = { updated_at: now };
  let statusChanged = false;
  let sourceChanged = false;

  const nextStatus = resolveJobStatusAfterPortalUpload(typedJob.status);

  if (nextStatus && nextStatus !== typedJob.status) {
    updatePayload.status = nextStatus;
    statusChanged = true;
  }

  if (shouldAutoSetPortalUploadSource(typedJob.artwork_source)) {
    updatePayload.artwork_source = "portal_upload";
    sourceChanged = true;
  }

  if (!statusChanged && !sourceChanged) {
    return { updated: false as const };
  }

  const { data: updatedJob, error: updateError } = await adminClient
    .from("jobs")
    .update(updatePayload)
    .eq("id", jobId)
    .select(JOB_LIST_COLUMNS)
    .maybeSingle();

  if (updateError || !updatedJob) {
    return { updated: false as const };
  }

  if (statusChanged && nextStatus) {
    try {
      await logJobStatusChangedActivity(adminClient, typedJob, {
        actorProfileId: options.actorProfileId ?? null,
        previousStatus: typedJob.status,
        newStatus: nextStatus,
        trigger: "portal_upload",
      });
    } catch {
      // Non-critical.
    }
  }

  return {
    updated: true as const,
    status: (updatedJob as JobRecord).status,
    artworkSource: (updatedJob as JobRecord).artwork_source,
  };
}

/** @deprecated Use syncJobAfterPortalUpload */
export async function maybeSetPortalUploadArtworkSource(
  adminClient: SupabaseClient,
  jobId: string
) {
  return syncJobAfterPortalUpload(adminClient, jobId);
}
