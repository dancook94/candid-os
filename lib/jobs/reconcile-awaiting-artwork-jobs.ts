import type { SupabaseClient } from "@supabase/supabase-js";

import { reconcileArtworkUploadRecord } from "@/lib/jobs/reconcile-artwork-upload";
import { JOB_ACTIVITY_TYPES, logJobActivity } from "@/lib/jobs/activity";
import { JOB_LIST_COLUMNS } from "@/lib/jobs/job-select";
import { revalidateJobPages } from "@/lib/jobs/revalidation";
import type { JobRecord } from "@/lib/jobs/types";

type ReconcileAwaitingArtworkJobsInput = {
  jobId?: string;
  actorProfileId?: string | null;
  logActivity?: boolean;
  trigger?: string;
};

export type ReconcileAwaitingArtworkJobsResult = {
  scannedJobIds: string[];
  updatedJobIds: string[];
  skippedJobIds: string[];
  errors: string[];
};

async function repairIncompleteFileRecords(
  adminClient: SupabaseClient,
  jobId: string
) {
  const { data: repairableFiles, error } = await adminClient
    .from("job_files")
    .select("id")
    .eq("job_id", jobId)
    .is("deleted_at", null)
    .in("upload_status", ["failed", "processing", "pending"]);

  if (error) {
    throw new Error(error.message);
  }

  for (const file of repairableFiles ?? []) {
    await reconcileArtworkUploadRecord(adminClient, {
      jobFileId: file.id,
      logActivity: false,
      trigger: "awaiting_artwork_file_reconciliation",
    });
  }
}

async function jobHasCompletedUpload(
  adminClient: SupabaseClient,
  jobId: string
) {
  await repairIncompleteFileRecords(adminClient, jobId);

  const { count, error } = await adminClient
    .from("job_files")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("upload_status", "complete")
    .is("deleted_at", null);

  if (error) {
    throw new Error(error.message);
  }

  return (count ?? 0) > 0;
}

export async function reconcileAwaitingArtworkJobStatuses(
  adminClient: SupabaseClient,
  input: ReconcileAwaitingArtworkJobsInput = {}
): Promise<ReconcileAwaitingArtworkJobsResult> {
  const result: ReconcileAwaitingArtworkJobsResult = {
    scannedJobIds: [],
    updatedJobIds: [],
    skippedJobIds: [],
    errors: [],
  };

  let query = adminClient
    .from("jobs")
    .select(JOB_LIST_COLUMNS)
    .eq("status", "awaiting_artwork");

  if (input.jobId) {
    query = query.eq("id", input.jobId);
  }

  const { data: jobs, error } = await query;

  if (error) {
    result.errors.push(error.message);
    return result;
  }

  for (const job of (jobs ?? []) as JobRecord[]) {
    result.scannedJobIds.push(job.id);

    try {
      const hasCompletedUpload = await jobHasCompletedUpload(adminClient, job.id);

      if (!hasCompletedUpload) {
        result.skippedJobIds.push(job.id);
        continue;
      }

      const now = new Date().toISOString();
      const { data: updatedJob, error: updateError } = await adminClient
        .from("jobs")
        .update({
          status: "artwork_uploaded",
          updated_at: now,
        })
        .eq("id", job.id)
        .eq("status", "awaiting_artwork")
        .select(JOB_LIST_COLUMNS)
        .maybeSingle();

      if (updateError) {
        result.errors.push(`${job.job_reference}: ${updateError.message}`);
        continue;
      }

      if (!updatedJob) {
        result.skippedJobIds.push(job.id);
        continue;
      }

      result.updatedJobIds.push(job.id);

      if (input.logActivity !== false) {
        try {
          await logJobActivity(adminClient, {
            activityType: JOB_ACTIVITY_TYPES.jobStatusReconciled,
            description: `Job ${job.job_reference} status reconciled to Artwork uploaded.`,
            companyId: job.company_id,
            quoteId: job.quote_id,
            opportunityId: job.opportunity_id,
            contactId: job.contact_id,
            actorProfileId: input.actorProfileId ?? null,
            metadata: {
              job_id: job.id,
              previous_status: "awaiting_artwork",
              new_status: "artwork_uploaded",
              trigger: input.trigger ?? "awaiting_artwork_reconciliation",
            },
          });
        } catch (activityError) {
          result.errors.push(
            `${job.job_reference}: ${
              activityError instanceof Error
                ? activityError.message
                : "Unable to log reconciliation activity."
            }`
          );
        }
      }

      revalidateJobPages({
        jobId: job.id,
        quoteId: job.quote_id,
        opportunityId: job.opportunity_id,
      });
    } catch (jobError) {
      result.errors.push(
        `${job.job_reference}: ${
          jobError instanceof Error ? jobError.message : "Reconciliation failed."
        }`
      );
    }
  }

  return result;
}
