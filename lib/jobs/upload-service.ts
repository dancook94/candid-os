import type { PostgrestError } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { DropboxError, isDropboxConfigured } from "@/lib/dropbox/client";
import {
  appendDropboxUploadSession,
  finishDropboxUploadSession,
  startDropboxUploadSession,
} from "@/lib/dropbox/upload-session";
import { ensureDropboxOnExistingJob } from "@/lib/jobs/create-from-quote";
import { resolveArtworkUploadedAtIso } from "@/lib/jobs/artwork-display";
import { isCustomerArtworkUploadEnabled } from "@/lib/jobs/artwork-source";
import {
  JOB_ACTIVITY_TYPES,
  logJobActivity,
} from "@/lib/jobs/activity";
import { prepareArtworkUploadedNotification } from "@/lib/jobs/notifications";
import type { CustomerJobContext } from "@/lib/jobs/auth";
import { JobError } from "@/lib/jobs/errors";
import {
  buildVersionedArtworkFileName,
  getArtworkExtension,
  sanitizeArtworkFileName,
  validateArtworkUploadInput,
} from "@/lib/jobs/file-validation";
import type { JobFileRecord } from "@/lib/jobs/types";
import { syncJobAfterPortalUpload } from "@/lib/jobs/update-artwork-source";
import { revalidateJobPages } from "@/lib/jobs/revalidation";
import { createAdminClient } from "@/lib/supabase/admin";

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

function logArtworkUploadStep(
  step: string,
  details: Record<string, unknown>
) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  console.info("[artwork-upload]", {
    step,
    ...details,
  });
}

function getUploadContextIds(context: CustomerJobContext) {
  const jobId = context.job?.id;
  const userId = context.profile?.id;
  const companyId = context.company?.id;

  if (!jobId || !userId || !companyId) {
    throw new JobError("Upload context is incomplete.", 500);
  }

  return { jobId, userId, companyId };
}

async function getNextArtworkVersion(
  adminClient: SupabaseClient,
  jobId: string,
  originalFileName: string,
  supersedesFileId?: string | null
) {
  if (supersedesFileId) {
    const { data: supersededFile } = await adminClient
      .from("job_files")
      .select("version_number, original_file_name")
      .eq("id", supersedesFileId)
      .maybeSingle();

    if (supersededFile) {
      return {
        versionNumber: (supersededFile.version_number ?? 1) + 1,
        originalFileName: supersededFile.original_file_name,
      };
    }
  }

  const baseName = sanitizeArtworkFileName(
    originalFileName.replace(/\.[^.]+$/, "") || originalFileName
  );

  const { data: existingVersions } = await adminClient
    .from("job_files")
    .select("version_number, original_file_name")
    .eq("job_id", jobId)
    .is("deleted_at", null);

  const matchingVersions = (existingVersions ?? []).filter((row) => {
    const existingBase = sanitizeArtworkFileName(
      row.original_file_name.replace(/\.[^.]+$/, "") || row.original_file_name
    );
    return existingBase === baseName;
  });

  const maxVersion = matchingVersions.reduce(
    (currentMax, row) => Math.max(currentMax, row.version_number ?? 1),
    0
  );

  return {
    versionNumber: maxVersion + 1,
    originalFileName,
  };
}

export async function createArtworkUploadSession(
  context: CustomerJobContext,
  input: {
    fileName: string;
    mimeType?: string | null;
    fileSizeBytes: number;
    customerNotes?: string | null;
    supersedesFileId?: string | null;
  }
) {
  const { jobId, userId, companyId } = getUploadContextIds(context);

  if (!isCustomerArtworkUploadEnabled(context.job)) {
    throw new JobError("Artwork uploads are not available for this job.", 409);
  }

  if (!isDropboxConfigured()) {
    throw new JobError("Dropbox integration is not configured.", 503);
  }

  const adminClient = createAdminClient();
  const jobWithDropbox = await ensureDropboxOnExistingJob(adminClient, context.job);

  if (
    jobWithDropbox.dropbox_setup_status !== "ready" ||
    !jobWithDropbox.dropbox_folder_path
  ) {
    throw new JobError(
      "Artwork upload is temporarily unavailable. Please contact Candid Creative.",
      503
    );
  }

  const validationError = validateArtworkUploadInput(input);
  if (validationError) {
    throw new JobError(validationError, 400);
  }

  if (input.supersedesFileId) {
    const { data: existing, error: existingError } = await adminClient
      .from("job_files")
      .select("id, artwork_status, upload_status")
      .eq("id", input.supersedesFileId)
      .eq("job_id", jobId)
      .maybeSingle();

    if (existingError) {
      throw new JobError(existingError.message, 500);
    }

    if (!existing) {
      throw new JobError("The artwork file to replace was not found.", 404);
    }

    if (
      existing.upload_status !== "complete" ||
      !["uploaded", "changes_required"].includes(existing.artwork_status)
    ) {
      throw new JobError("This artwork file cannot be replaced in its current state.", 409);
    }
  }

  const { versionNumber, originalFileName } = await getNextArtworkVersion(
    adminClient,
    jobId,
    input.fileName,
    input.supersedesFileId
  );

  const storedFileName = buildVersionedArtworkFileName(input.fileName, versionNumber);
  const dropboxFolder = `${jobWithDropbox.dropbox_folder_path}/01 Customer Artwork`;
  const dropboxPath = `${dropboxFolder}/${storedFileName}`;

  let dropboxSession: { session_id?: string };
  try {
    dropboxSession = await startDropboxUploadSession();
  } catch (error) {
    logArtworkUploadStep("dropbox_session_start_failed", {
      jobId,
      userId,
      companyId,
      message: error instanceof Error ? error.message : "Dropbox upload failed.",
    });

    throw new JobError(
      error instanceof DropboxError
        ? `Dropbox upload failed: ${error.message}`
        : "Dropbox upload failed.",
      502
    );
  }

  if (!dropboxSession?.session_id) {
    logArtworkUploadStep("dropbox_session_start_failed", {
      jobId,
      userId,
      companyId,
      message: "Dropbox did not return a session id.",
    });
    throw new JobError("Dropbox upload failed.", 502);
  }

  const { data: pendingRecord, error: insertError } = await adminClient
    .from("job_files")
    .insert({
      job_id: jobId,
      company_id: companyId,
      uploaded_by_profile_id: userId,
      file_name: storedFileName,
      original_file_name: originalFileName,
      file_extension: getArtworkExtension(input.fileName),
      mime_type: input.mimeType?.trim() || null,
      file_size_bytes: input.fileSizeBytes,
      upload_status: "pending",
      artwork_status: "uploaded",
      customer_notes: input.customerNotes?.trim() || null,
      version_number: versionNumber,
      supersedes_file_id: input.supersedesFileId ?? null,
    })
    .select("*")
    .single();

  logArtworkUploadStep("database_insert", {
    jobId,
    userId,
    companyId,
    uploadRecordId: pendingRecord?.id ?? null,
    supabase: formatSupabaseError(insertError),
  });

  if (insertError || !pendingRecord?.id) {
    throw new JobError(
      insertError?.message ?? "Artwork record could not be created.",
      500
    );
  }

  const { data: fileRecord, error: sessionUpdateError } = await adminClient
    .from("job_files")
    .update({
      dropbox_upload_session_id: dropboxSession.session_id,
      upload_session_offset: 0,
      upload_status: "uploading",
    })
    .eq("id", pendingRecord.id)
    .select("*")
    .single();

  logArtworkUploadStep("database_uploading", {
    jobId,
    userId,
    companyId,
    uploadRecordId: fileRecord?.id ?? null,
    supabase: formatSupabaseError(sessionUpdateError),
  });

  if (sessionUpdateError || !fileRecord?.id) {
    await adminClient
      .from("job_files")
      .update({ upload_status: "failed" })
      .eq("id", pendingRecord.id);

    throw new JobError(
      sessionUpdateError?.message ?? "Artwork record could not be created.",
      500
    );
  }

  return {
    file: fileRecord as JobFileRecord,
    dropboxPath,
    sessionId: dropboxSession.session_id,
  };
}

export async function appendArtworkUploadChunk(
  context: CustomerJobContext,
  fileId: string,
  chunk: ArrayBuffer
) {
  const { jobId, userId, companyId } = getUploadContextIds(context);

  if (!fileId) {
    throw new JobError("Upload session not found.", 404);
  }

  const adminClient = createAdminClient();
  const { data: file, error } = await adminClient
    .from("job_files")
    .select("*")
    .eq("id", fileId)
    .eq("job_id", jobId)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new JobError(error.message, 500);
  }

  if (!file?.id) {
    throw new JobError("Upload session not found.", 404);
  }

  if (file.upload_status !== "uploading" || !file.dropbox_upload_session_id) {
    throw new JobError("This upload session is no longer active.", 409);
  }

  const offset = file.upload_session_offset ?? 0;

  try {
    await appendDropboxUploadSession(file.dropbox_upload_session_id, offset, chunk);
  } catch (error) {
    logArtworkUploadStep("dropbox_chunk_failed", {
      jobId,
      userId,
      companyId,
      fileId: file.id,
      offset,
      message: error instanceof Error ? error.message : "Dropbox upload failed.",
    });

    throw new JobError(
      error instanceof DropboxError
        ? `Dropbox upload failed: ${error.message}`
        : "Dropbox upload failed.",
      502
    );
  }

  const nextOffset = offset + chunk.byteLength;
  const { error: updateError } = await adminClient
    .from("job_files")
    .update({
      upload_session_offset: nextOffset,
    })
    .eq("id", file.id);

  if (updateError) {
    throw new JobError(updateError.message, 500);
  }

  return {
    uploadedBytes: nextOffset,
    totalBytes: file.file_size_bytes,
  };
}

export async function finishArtworkUpload(
  context: CustomerJobContext,
  fileId: string
) {
  const { jobId, userId, companyId } = getUploadContextIds(context);

  if (!fileId) {
    throw new JobError("Upload session not found.", 404);
  }

  const adminClient = createAdminClient();
  const { data: file, error } = await adminClient
    .from("job_files")
    .select("*")
    .eq("id", fileId)
    .eq("job_id", jobId)
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new JobError(error.message, 500);
  }

  if (!file?.id) {
    throw new JobError("Upload session not found.", 404);
  }

  if (file.upload_status !== "uploading" || !file.dropbox_upload_session_id) {
    throw new JobError("This upload session is no longer active.", 409);
  }

  const uploadedOffset = file.upload_session_offset ?? 0;
  if (uploadedOffset !== file.file_size_bytes) {
    throw new JobError("Upload is incomplete.", 400);
  }

  const jobWithDropbox = await ensureDropboxOnExistingJob(adminClient, context.job);

  if (!jobWithDropbox.dropbox_folder_path) {
    throw new JobError(
      "Artwork upload is temporarily unavailable. Please contact Candid Creative.",
      503
    );
  }

  const dropboxPath = `${jobWithDropbox.dropbox_folder_path}/01 Customer Artwork/${file.file_name}`;

  logArtworkUploadStep("finish_start", {
    jobId,
    userId,
    companyId,
    uploadRecordId: file.id,
    uploadStatus: file.upload_status,
    uploadedBytes: uploadedOffset,
    expectedBytes: file.file_size_bytes,
  });

  await adminClient
    .from("job_files")
    .update({ upload_status: "processing" })
    .eq("id", file.id);

  let dropboxMetadata;
  try {
    dropboxMetadata = await finishDropboxUploadSession({
      sessionId: file.dropbox_upload_session_id,
      totalSize: file.file_size_bytes,
      dropboxPath,
    });
  } catch (error) {
    await adminClient
      .from("job_files")
      .update({
        upload_status: "failed",
        dropbox_upload_session_id: null,
        upload_session_offset: null,
      })
      .eq("id", file.id);

    logArtworkUploadStep("dropbox_finish_failed", {
      jobId,
      userId,
      companyId,
      fileId: file.id,
      message: error instanceof Error ? error.message : "Dropbox upload failed.",
    });

    try {
      await logJobActivity(adminClient, {
        activityType: JOB_ACTIVITY_TYPES.artworkUploadFailed,
        description: `Artwork upload failed for ${context.job.job_reference}.`,
        companyId,
        quoteId: context.job.quote_id,
        opportunityId: context.job.opportunity_id,
        contactId: context.contact?.id ?? null,
        actorProfileId: userId,
        metadata: {
          job_id: jobId,
          job_file_id: file.id,
          version_number: file.version_number,
        },
      });
    } catch (activityError) {
      logArtworkUploadStep("activity_log_failed", {
        jobId,
        fileId: file.id,
        message:
          activityError instanceof Error
            ? activityError.message
            : "Unable to create activity log.",
      });
    }

    throw new JobError(
      error instanceof DropboxError
        ? `Dropbox upload failed: ${error.message}`
        : "Dropbox upload failed.",
      502
    );
  }

  if (!dropboxMetadata?.id || !dropboxMetadata.path_lower || !dropboxMetadata.rev) {
    await adminClient
      .from("job_files")
      .update({
        upload_status: "failed",
        dropbox_upload_session_id: null,
        upload_session_offset: null,
      })
      .eq("id", file.id);

    throw new JobError("Dropbox upload failed.", 502);
  }

  logArtworkUploadStep("dropbox_commit_success", {
    jobId,
    userId,
    companyId,
    uploadRecordId: file.id,
    dropboxFileIdPresent: true,
  });

  if (file.supersedes_file_id) {
    await adminClient
      .from("job_files")
      .update({
        artwork_status: "superseded",
      })
      .eq("id", file.supersedes_file_id)
      .eq("job_id", jobId);
  }

  const now = resolveArtworkUploadedAtIso(dropboxMetadata.server_modified);
  const completionPayload = {
    dropbox_file_id: dropboxMetadata.id,
    dropbox_path_lower: dropboxMetadata.path_lower,
    dropbox_revision: dropboxMetadata.rev,
    content_hash: dropboxMetadata.content_hash ?? null,
    dropbox_upload_session_id: null,
    upload_session_offset: null,
    upload_status: "complete" as const,
    artwork_status: "uploaded" as const,
    uploaded_at: now,
    customer_notes: file.customer_notes?.trim() || null,
    file_size_bytes: dropboxMetadata.size ?? file.file_size_bytes,
  };

  const { data: completedFile, error: completeError } = await adminClient
    .from("job_files")
    .update(completionPayload)
    .eq("id", file.id)
    .select("*")
    .single();

  logArtworkUploadStep("database_complete", {
    jobId,
    userId,
    companyId,
    uploadRecordId: file.id,
    recordId: completedFile?.id ?? null,
    supabase: formatSupabaseError(completeError),
  });

  if (completeError || !completedFile?.id) {
    await adminClient
      .from("job_files")
      .update({
        dropbox_file_id: dropboxMetadata.id,
        dropbox_path_lower: dropboxMetadata.path_lower,
        dropbox_revision: dropboxMetadata.rev,
        content_hash: dropboxMetadata.content_hash ?? null,
        dropbox_upload_session_id: null,
        upload_session_offset: null,
        upload_status: "processing",
        uploaded_at: now,
        customer_notes: file.customer_notes?.trim() || null,
        file_size_bytes: dropboxMetadata.size ?? file.file_size_bytes,
      })
      .eq("id", file.id);

    throw new JobError(
      completeError?.message ?? "Artwork record could not be completed.",
      500
    );
  }

  try {
    const jobStatusResult = await syncJobAfterPortalUpload(adminClient, jobId, {
      actorProfileId: userId,
    });

    logArtworkUploadStep("job_status_update", {
      jobId,
      uploadRecordId: file.id,
      updated: jobStatusResult.updated,
      status: jobStatusResult.status ?? null,
    });
  } catch (jobStatusError) {
    logArtworkUploadStep("job_status_update_failed", {
      jobId,
      uploadRecordId: file.id,
      message:
        jobStatusError instanceof Error
          ? jobStatusError.message
          : "Job status update failed.",
    });
  }

  try {
    await logJobActivity(adminClient, {
      activityType: file.supersedes_file_id
        ? JOB_ACTIVITY_TYPES.customerArtworkReplaced
        : JOB_ACTIVITY_TYPES.customerArtworkUploaded,
      description: file.supersedes_file_id
        ? `${context.company.company_name} uploaded replacement artwork for ${context.job.job_reference}.`
        : `${context.company.company_name} uploaded artwork for ${context.job.job_reference}.`,
      companyId,
      quoteId: context.job.quote_id,
      opportunityId: context.job.opportunity_id,
      contactId: context.contact?.id ?? null,
      actorProfileId: userId,
      metadata: {
        job_id: jobId,
        job_file_id: file.id,
        version_number: file.version_number,
        file_name: file.file_name,
        file_size_bytes: file.file_size_bytes,
      },
    });
  } catch (activityError) {
    logArtworkUploadStep("activity_insert_failed", {
      jobId,
      uploadRecordId: file.id,
      message:
        activityError instanceof Error
          ? activityError.message
          : "Unable to create activity log.",
    });
  }

  try {
    await prepareArtworkUploadedNotification({
      adminClient,
      companyId,
      jobId,
      fileId: file.id,
    });
  } catch (notificationError) {
    logArtworkUploadStep("notification_prepare_failed", {
      jobId,
      uploadRecordId: file.id,
      message:
        notificationError instanceof Error
          ? notificationError.message
          : "Unable to prepare artwork notification.",
    });
  }

  try {
    revalidateJobPages({
      jobId,
      quoteId: context.job.quote_id,
      opportunityId: context.job.opportunity_id,
    });
  } catch (revalidationError) {
    logArtworkUploadStep("revalidation_failed", {
      jobId,
      uploadRecordId: file.id,
      message:
        revalidationError instanceof Error
          ? revalidationError.message
          : "Route revalidation failed.",
    });
  }

  return completedFile as JobFileRecord;
}

export async function softDeleteCustomerArtworkFile(
  context: CustomerJobContext,
  fileId: string
) {
  const adminClient = createAdminClient();
  const { data: file, error } = await adminClient
    .from("job_files")
    .select("*")
    .eq("id", fileId)
    .eq("job_id", context.job.id)
    .eq("company_id", context.company.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !file) {
    throw new JobError("Artwork file not found.", 404);
  }

  if (
    file.upload_status !== "complete" ||
    !["uploaded", "changes_required"].includes(file.artwork_status)
  ) {
    throw new JobError("This artwork file cannot be removed in its current state.", 409);
  }

  const now = new Date().toISOString();
  const { error: deleteError } = await adminClient
    .from("job_files")
    .update({
      deleted_at: now,
      deleted_by: context.profile.id,
    })
    .eq("id", file.id);

  if (deleteError) {
    throw new JobError(deleteError.message, 500);
  }
}

export async function cancelArtworkUpload(
  context: CustomerJobContext,
  fileId: string
) {
  const adminClient = createAdminClient();

  await adminClient
    .from("job_files")
    .update({
      upload_status: "cancelled",
      dropbox_upload_session_id: null,
      upload_session_offset: null,
      deleted_at: new Date().toISOString(),
      deleted_by: context.profile.id,
    })
    .eq("id", fileId)
    .eq("job_id", context.job.id)
    .eq("company_id", context.company.id)
    .eq("upload_status", "uploading");
}
