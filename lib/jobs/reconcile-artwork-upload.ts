import type { PostgrestError } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DropboxError,
  getDropboxFileMetadataByPath,
  isDropboxConfigured,
  listDropboxFolderFiles,
  type DropboxFileMetadata,
} from "@/lib/dropbox/client";
import { resolveArtworkUploadedAtIso } from "@/lib/jobs/artwork-display";
import { JOB_ACTIVITY_TYPES, logJobActivity } from "@/lib/jobs/activity";
import { JobError } from "@/lib/jobs/errors";
import { JOB_LIST_COLUMNS } from "@/lib/jobs/job-select";
import { syncJobAfterPortalUpload } from "@/lib/jobs/update-artwork-source";
import { revalidateJobPages } from "@/lib/jobs/revalidation";
import type { JobFileRecord, JobRecord } from "@/lib/jobs/types";

type ReconcileArtworkUploadInput = {
  jobFileId: string;
  actorProfileId?: string | null;
  logActivity?: boolean;
  trigger?: string;
};

export type ReconcileArtworkUploadResult = {
  ok: boolean;
  jobFileId: string;
  jobId: string | null;
  previousUploadStatus: string | null;
  updated: boolean;
  dropboxVerified: boolean;
  jobStatusUpdated: boolean;
  error: string | null;
};

function logReconcileStep(step: string, details: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  console.info("[artwork-upload-reconcile]", {
    step,
    ...details,
  });
}

function formatSupabaseError(error: PostgrestError | null) {
  if (!error) {
    return null;
  }

  return {
    message: error.message,
    code: error.code,
    details: error.details,
    hint: error.hint,
  };
}

function buildExpectedDropboxPath(job: JobRecord, fileName: string) {
  if (!job.dropbox_folder_path) {
    return null;
  }

  return `${job.dropbox_folder_path}/01 Customer Artwork/${fileName}`;
}

async function findVerifiedDropboxFile(
  job: JobRecord,
  file: JobFileRecord
): Promise<DropboxFileMetadata | null> {
  const expectedPath = buildExpectedDropboxPath(job, file.file_name);

  if (expectedPath) {
    const exactMatch = await getDropboxFileMetadataByPath(expectedPath);

    if (exactMatch?.id) {
      return exactMatch;
    }
  }

  if (!job.dropbox_folder_path) {
    return null;
  }

  const folderPath = `${job.dropbox_folder_path}/01 Customer Artwork`;
  const folderFiles = await listDropboxFolderFiles(folderPath);
  const normalizedFileName = file.file_name.toLowerCase();
  const normalizedOriginalName = file.original_file_name.toLowerCase();

  return (
    folderFiles.find(
      (entry) =>
        entry.name === file.file_name ||
        entry.name.toLowerCase() === normalizedFileName ||
        entry.name.toLowerCase() === normalizedOriginalName
    ) ?? null
  );
}

export async function reconcileArtworkUploadRecord(
  adminClient: SupabaseClient,
  input: ReconcileArtworkUploadInput
): Promise<ReconcileArtworkUploadResult> {
  const result: ReconcileArtworkUploadResult = {
    ok: false,
    jobFileId: input.jobFileId,
    jobId: null,
    previousUploadStatus: null,
    updated: false,
    dropboxVerified: false,
    jobStatusUpdated: false,
    error: null,
  };

  if (!isDropboxConfigured()) {
    result.error = "Dropbox integration is not configured.";
    return result;
  }

  const { data: file, error: fileError } = await adminClient
    .from("job_files")
    .select("*")
    .eq("id", input.jobFileId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fileError) {
    result.error = fileError.message;
    logReconcileStep("load_file_failed", {
      jobFileId: input.jobFileId,
      supabase: formatSupabaseError(fileError),
    });
    return result;
  }

  if (!file?.id) {
    result.error = "Artwork file not found.";
    return result;
  }

  result.jobId = file.job_id;
  result.previousUploadStatus = file.upload_status;

  if (file.upload_status === "complete") {
    result.ok = true;
    return result;
  }

  const { data: job, error: jobError } = await adminClient
    .from("jobs")
    .select(JOB_LIST_COLUMNS)
    .eq("id", file.job_id)
    .maybeSingle();

  if (jobError || !job) {
    result.error = jobError?.message ?? "Job not found.";
    return result;
  }

  const typedJob = job as JobRecord;
  let dropboxMetadata: DropboxFileMetadata | null =
    file.dropbox_file_id && file.dropbox_path_lower
      ? {
          id: file.dropbox_file_id,
          name: file.file_name,
          path_lower: file.dropbox_path_lower,
          path_display: file.dropbox_path_lower,
          rev: file.dropbox_revision ?? "",
          size: file.file_size_bytes,
          content_hash: file.content_hash ?? undefined,
          server_modified: file.uploaded_at ?? undefined,
        }
      : null;

  if (!dropboxMetadata?.id) {
    try {
      const verified = await findVerifiedDropboxFile(typedJob, file as JobFileRecord);

      if (!verified?.id) {
        result.error = "Dropbox file could not be verified at the expected path.";
        logReconcileStep("dropbox_verify_failed", {
          jobFileId: file.id,
          jobId: typedJob.id,
          dropboxFileIdPresent: false,
        });
        return result;
      }

      dropboxMetadata = verified;
      result.dropboxVerified = true;

      logReconcileStep("dropbox_verify_success", {
        jobFileId: file.id,
        jobId: typedJob.id,
        dropboxFileIdPresent: true,
      });
    } catch (error) {
      result.error =
        error instanceof DropboxError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Dropbox verification failed.";
      return result;
    }
  } else {
    result.dropboxVerified = true;
  }

  const uploadedAt = resolveArtworkUploadedAtIso(dropboxMetadata.server_modified);
  const completionPayload = {
    dropbox_file_id: dropboxMetadata.id,
    dropbox_path_lower: dropboxMetadata.path_lower,
    dropbox_revision: dropboxMetadata.rev,
    content_hash: dropboxMetadata.content_hash ?? null,
    dropbox_upload_session_id: null,
    upload_session_offset: null,
    upload_status: "complete" as const,
    artwork_status: "uploaded" as const,
    uploaded_at: uploadedAt,
    customer_notes: file.customer_notes?.trim() || null,
    file_size_bytes: dropboxMetadata.size ?? file.file_size_bytes,
  };

  const { data: completedFile, error: completeError } = await adminClient
    .from("job_files")
    .update(completionPayload)
    .eq("id", file.id)
    .select("*")
    .single();

  logReconcileStep("database_complete", {
    jobFileId: file.id,
    jobId: typedJob.id,
    recordId: completedFile?.id ?? null,
    supabase: formatSupabaseError(completeError),
  });

  if (completeError || !completedFile?.id) {
    result.error = completeError?.message ?? "Artwork record could not be completed.";
    return result;
  }

  result.updated = true;

  try {
    const jobStatusResult = await syncJobAfterPortalUpload(adminClient, typedJob.id);
    result.jobStatusUpdated = jobStatusResult.updated;

    logReconcileStep("job_status_update", {
      jobFileId: file.id,
      jobId: typedJob.id,
      updated: jobStatusResult.updated,
      status: jobStatusResult.status ?? null,
    });
  } catch (jobStatusError) {
    logReconcileStep("job_status_update_failed", {
      jobFileId: file.id,
      jobId: typedJob.id,
      message:
        jobStatusError instanceof Error
          ? jobStatusError.message
          : "Job status update failed.",
    });
  }

  if (input.logActivity !== false) {
    try {
      await logJobActivity(adminClient, {
        activityType: JOB_ACTIVITY_TYPES.jobStatusReconciled,
        description: `Artwork upload reconciled for ${typedJob.job_reference}.`,
        companyId: typedJob.company_id,
        quoteId: typedJob.quote_id,
        opportunityId: typedJob.opportunity_id,
        contactId: typedJob.contact_id,
        actorProfileId: input.actorProfileId ?? null,
        metadata: {
          job_id: typedJob.id,
          job_file_id: file.id,
          previous_upload_status: file.upload_status,
          trigger: input.trigger ?? "artwork_upload_reconciliation",
        },
      });
    } catch (activityError) {
      logReconcileStep("activity_log_failed", {
        jobFileId: file.id,
        jobId: typedJob.id,
        message:
          activityError instanceof Error
            ? activityError.message
            : "Unable to log reconciliation activity.",
      });
    }
  }

  try {
    revalidateJobPages({
      jobId: typedJob.id,
      quoteId: typedJob.quote_id,
      opportunityId: typedJob.opportunity_id,
    });
  } catch (revalidationError) {
    logReconcileStep("revalidation_failed", {
      jobFileId: file.id,
      jobId: typedJob.id,
      message:
        revalidationError instanceof Error
          ? revalidationError.message
          : "Route revalidation failed.",
    });
  }

  result.ok = true;
  return result;
}

export async function reconcileArtworkUploadRecordOrThrow(
  adminClient: SupabaseClient,
  input: ReconcileArtworkUploadInput
) {
  const result = await reconcileArtworkUploadRecord(adminClient, input);

  if (!result.ok) {
    throw new JobError(result.error ?? "Artwork upload reconciliation failed.", 500);
  }

  return result;
}
