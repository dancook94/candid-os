import type { SupabaseClient } from "@supabase/supabase-js";

import { buildCustomerArtworkFolderPath } from "@/lib/dropbox/job-folders";
import {
  appendDropboxUploadSession,
  finishDropboxUploadSession,
  startDropboxUploadSession,
} from "@/lib/dropbox/upload-session";
import { isDropboxConfigured } from "@/lib/dropbox/client";
import {
  JOB_ACTIVITY_TYPES,
  logJobActivity,
  prepareArtworkUploadedNotification,
} from "@/lib/jobs/activity";
import type { CustomerJobContext } from "@/lib/jobs/auth";
import { JobError } from "@/lib/jobs/errors";
import {
  buildVersionedArtworkFileName,
  getArtworkExtension,
  sanitizeArtworkFileName,
  validateArtworkUploadInput,
} from "@/lib/jobs/file-validation";
import type { JobFileRecord } from "@/lib/jobs/types";
import { createAdminClient } from "@/lib/supabase/admin";

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
  if (!isDropboxConfigured()) {
    throw new JobError("Dropbox integration is not configured.", 503);
  }

  const validationError = validateArtworkUploadInput(input);
  if (validationError) {
    throw new JobError(validationError, 400);
  }

  if (input.supersedesFileId) {
    const adminClient = createAdminClient();
    const { data: existing, error: existingError } = await adminClient
      .from("job_files")
      .select("id, artwork_status, upload_status")
      .eq("id", input.supersedesFileId)
      .eq("job_id", context.job.id)
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

  const adminClient = createAdminClient();
  const { versionNumber, originalFileName } = await getNextArtworkVersion(
    adminClient,
    context.job.id,
    input.fileName,
    input.supersedesFileId
  );

  const storedFileName = buildVersionedArtworkFileName(input.fileName, versionNumber);
  const dropboxFolder = buildCustomerArtworkFolderPath(
    context.job.job_reference,
    context.job.project_name
  );
  const dropboxPath = `${dropboxFolder}/${storedFileName}`;

  const dropboxSession = await startDropboxUploadSession();

  const { data: fileRecord, error } = await adminClient
    .from("job_files")
    .insert({
      job_id: context.job.id,
      company_id: context.company.id,
      uploaded_by_profile_id: context.profile.id,
      file_name: storedFileName,
      original_file_name: originalFileName,
      file_extension: getArtworkExtension(input.fileName),
      mime_type: input.mimeType?.trim() || null,
      file_size_bytes: input.fileSizeBytes,
      dropbox_upload_session_id: dropboxSession.session_id,
      upload_session_offset: 0,
      upload_status: "uploading",
      artwork_status: input.supersedesFileId ? "uploaded" : "uploaded",
      customer_notes: input.customerNotes?.trim() || null,
      version_number: versionNumber,
      supersedes_file_id: input.supersedesFileId ?? null,
    })
    .select("*")
    .single();

  if (error || !fileRecord) {
    throw new JobError(error?.message ?? "Unable to start artwork upload.", 500);
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
    throw new JobError("Upload session not found.", 404);
  }

  if (file.upload_status !== "uploading" || !file.dropbox_upload_session_id) {
    throw new JobError("This upload session is no longer active.", 409);
  }

  const offset = file.upload_session_offset ?? 0;
  await appendDropboxUploadSession(file.dropbox_upload_session_id, offset, chunk);

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
    throw new JobError("Upload session not found.", 404);
  }

  if (file.upload_status !== "uploading" || !file.dropbox_upload_session_id) {
    throw new JobError("This upload session is no longer active.", 409);
  }

  const uploadedOffset = file.upload_session_offset ?? 0;
  if (uploadedOffset !== file.file_size_bytes) {
    throw new JobError("Upload is incomplete.", 400);
  }

  const dropboxPath = `${buildCustomerArtworkFolderPath(
    context.job.job_reference,
    context.job.project_name
  )}/${file.file_name}`;

  await adminClient
    .from("job_files")
    .update({ upload_status: "processing" })
    .eq("id", file.id);

  try {
    const finished = await finishDropboxUploadSession({
      sessionId: file.dropbox_upload_session_id,
      totalSize: file.file_size_bytes,
      dropboxPath,
    });

    const now = new Date().toISOString();

    if (file.supersedes_file_id) {
      await adminClient
        .from("job_files")
        .update({
          artwork_status: "superseded",
        })
        .eq("id", file.supersedes_file_id)
        .eq("job_id", context.job.id);
    }

    const { data: completedFile, error: completeError } = await adminClient
      .from("job_files")
      .update({
        dropbox_file_id: finished.metadata.id,
        dropbox_path_lower: finished.metadata.path_lower,
        dropbox_revision: finished.metadata.rev,
        content_hash: finished.metadata.content_hash ?? null,
        dropbox_upload_session_id: null,
        upload_session_offset: null,
        upload_status: "complete",
        artwork_status: "uploaded",
        uploaded_at: now,
      })
      .eq("id", file.id)
      .select("*")
      .single();

    if (completeError || !completedFile) {
      throw new JobError(completeError?.message ?? "Unable to finalise upload.", 500);
    }

    await logJobActivity(adminClient, {
      activityType: file.supersedes_file_id
        ? JOB_ACTIVITY_TYPES.customerArtworkReplaced
        : JOB_ACTIVITY_TYPES.customerArtworkUploaded,
      description: file.supersedes_file_id
        ? `${context.company.company_name} uploaded replacement artwork for ${context.job.job_reference}.`
        : `${context.company.company_name} uploaded artwork for ${context.job.job_reference}.`,
      companyId: context.company.id,
      quoteId: context.job.quote_id,
      opportunityId: context.job.opportunity_id,
      contactId: context.contact?.id ?? null,
      actorProfileId: context.profile.id,
      metadata: {
        job_id: context.job.id,
        job_file_id: file.id,
        version_number: file.version_number,
        file_name: file.file_name,
      },
    });

    prepareArtworkUploadedNotification({
      companyId: context.company.id,
      jobId: context.job.id,
      fileId: file.id,
    });

    return completedFile as JobFileRecord;
  } catch (uploadError) {
    await adminClient
      .from("job_files")
      .update({
        upload_status: "failed",
        dropbox_upload_session_id: null,
        upload_session_offset: null,
      })
      .eq("id", file.id);

    await logJobActivity(adminClient, {
      activityType: JOB_ACTIVITY_TYPES.artworkUploadFailed,
      description: `Artwork upload failed for ${context.job.job_reference}.`,
      companyId: context.company.id,
      quoteId: context.job.quote_id,
      opportunityId: context.job.opportunity_id,
      contactId: context.contact?.id ?? null,
      actorProfileId: context.profile.id,
      metadata: {
        job_id: context.job.id,
        job_file_id: file.id,
        version_number: file.version_number,
      },
    });

    throw uploadError instanceof JobError
      ? uploadError
      : new JobError(
          uploadError instanceof Error
            ? uploadError.message
            : "Artwork upload failed.",
          502
        );
  }
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
