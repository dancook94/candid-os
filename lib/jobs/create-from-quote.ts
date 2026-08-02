import type { SupabaseClient } from "@supabase/supabase-js";

import { CRM_ACTIVITY_TYPES } from "@/lib/crm/activity-types";
import { isDropboxConfigured } from "@/lib/dropbox/client";
import { ensureJobDropboxFolders } from "@/lib/dropbox/job-folders";
import { logJobActivity } from "@/lib/jobs/activity";
import { isMissingJobsSchemaError, JobError } from "@/lib/jobs/errors";
import { JOB_LIST_COLUMNS } from "@/lib/jobs/job-select";
import {
  prepareArtworkRequestedNotification,
  prepareJobCreatedNotification,
  prepareQuoteAcceptedNotification,
} from "@/lib/jobs/notifications";
import type { DropboxSetupStatus, JobRecord } from "@/lib/jobs/types";
import { resolveQuoteRequestIdForQuote } from "@/lib/quote-request-link";
import { createAdminClient } from "@/lib/supabase/admin";

type QuoteForJob = {
  id: string;
  company_id: string;
  quote_number: number;
  project_name: string;
  opportunity_id: string | null;
  quote_request_id: string | null;
  contact_id: string | null;
  current_version: number;
  status: string;
};

type QuoteVersionForJob = {
  id: string;
  version_number: number;
  version_status: string;
  accepted_at: string | null;
};

export type EnsureJobResult = {
  job: JobRecord | null;
  created: boolean;
  dropboxReady: boolean;
  dropboxSetupStatus: DropboxSetupStatus;
  schemaMissing: boolean;
  warning: string | null;
};

function buildJobReference(quoteNumber: number) {
  return `J-${quoteNumber}`;
}

async function loadQuoteForJobCreation(
  adminClient: SupabaseClient,
  quoteId: string
): Promise<QuoteForJob | null> {
  const { data, error } = await adminClient
    .from("quotes")
    .select(
      "id, company_id, quote_number, project_name, opportunity_id, quote_request_id, contact_id, current_version, status"
    )
    .eq("id", quoteId)
    .maybeSingle();

  if (error) {
    if (isMissingJobsSchemaError(error)) {
      return null;
    }

    throw new JobError(error.message, 500);
  }

  return data as QuoteForJob | null;
}

async function loadCurrentQuoteVersion(
  adminClient: SupabaseClient,
  quote: QuoteForJob
): Promise<QuoteVersionForJob | null> {
  const { data, error } = await adminClient
    .from("quote_versions")
    .select("id, version_number, version_status, accepted_at")
    .eq("quote_id", quote.id)
    .eq("version_number", quote.current_version)
    .maybeSingle();

  if (error) {
    throw new JobError(error.message, 500);
  }

  return data as QuoteVersionForJob | null;
}

async function resolveQuoteRequestId(
  adminClient: SupabaseClient,
  quote: QuoteForJob
) {
  if (quote.quote_request_id) {
    return quote.quote_request_id;
  }

  if (!quote.opportunity_id) {
    return null;
  }

  return resolveQuoteRequestIdForQuote(adminClient, {
    quoteRequestId: null,
    opportunityId: quote.opportunity_id,
    companyId: quote.company_id,
  });
}

async function loadQuoteRequestContext(
  adminClient: SupabaseClient,
  quoteRequestId: string | null
) {
  if (!quoteRequestId) {
    return {
      fulfilment_method: null as string | null,
      required_date: null as string | null,
    };
  }

  const { data } = await adminClient
    .from("quote_requests")
    .select("fulfilment_method, requested_date")
    .eq("id", quoteRequestId)
    .maybeSingle();

  return {
    fulfilment_method: data?.fulfilment_method ?? null,
    required_date: data?.requested_date ?? null,
  };
}

async function hasJobCreatedActivity(
  adminClient: SupabaseClient,
  quoteId: string
) {
  const { data, error } = await adminClient
    .from("crm_activity")
    .select("id")
    .eq("quote_id", quoteId)
    .eq("activity_type", CRM_ACTIVITY_TYPES.jobCreatedFromAcceptedQuote)
    .limit(1);

  if (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("[jobs] failed to check job_created activity", {
        quoteId,
        message: error.message,
      });
    }

    return false;
  }

  return (data?.length ?? 0) > 0;
}

async function logJobCreatedFromAcceptedQuote({
  adminClient,
  quote,
  quoteRequestId,
  job,
  actorProfileId,
}: {
  adminClient: SupabaseClient;
  quote: QuoteForJob;
  quoteRequestId: string | null;
  job: JobRecord;
  actorProfileId?: string | null;
}) {
  const alreadyLogged = await hasJobCreatedActivity(adminClient, quote.id);

  if (alreadyLogged) {
    return;
  }

  await logJobActivity(adminClient, {
    activityType: CRM_ACTIVITY_TYPES.jobCreatedFromAcceptedQuote,
    description: `Job ${job.job_reference} created from accepted quote Q-${quote.quote_number}.`,
    companyId: quote.company_id,
    contactId: quote.contact_id,
    opportunityId: quote.opportunity_id,
    quoteId: quote.id,
    actorProfileId: actorProfileId ?? null,
    metadata: {
      job_id: job.id,
      job_reference: job.job_reference,
      quote_request_id: quoteRequestId,
    },
  });
}

async function provisionDropboxForJob({
  jobReference,
  projectName,
}: {
  jobReference: string;
  projectName: string;
}) {
  if (!isDropboxConfigured()) {
    return {
      dropboxFolderPath: null as string | null,
      dropboxFolderId: null as string | null,
      dropboxSetupStatus: "pending" as DropboxSetupStatus,
      dropboxReady: false,
    };
  }

  try {
    const folders = await ensureJobDropboxFolders({
      jobReference,
      projectName,
    });

    return {
      dropboxFolderPath: folders.rootPath,
      dropboxFolderId: folders.rootFolderId,
      dropboxSetupStatus: "ready" as DropboxSetupStatus,
      dropboxReady: true,
    };
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("[jobs] Dropbox folder provisioning failed", {
        jobReference,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      dropboxFolderPath: null,
      dropboxFolderId: null,
      dropboxSetupStatus: "failed" as DropboxSetupStatus,
      dropboxReady: false,
    };
  }
}

export async function ensureDropboxOnExistingJob(
  adminClient: SupabaseClient,
  job: JobRecord
): Promise<JobRecord> {
  if (job.dropbox_setup_status === "ready" && job.dropbox_folder_path) {
    return job;
  }

  if (!isDropboxConfigured()) {
    return job;
  }

  const provisioned = await provisionDropboxForJob({
    jobReference: job.job_reference,
    projectName: job.project_name,
  });

  if (!provisioned.dropboxReady) {
    if (job.dropbox_setup_status !== "failed") {
      await adminClient
        .from("jobs")
        .update({ dropbox_setup_status: "failed" })
        .eq("id", job.id);
    }

    return { ...job, dropbox_setup_status: "failed" as DropboxSetupStatus };
  }

  const { data: updatedJob, error } = await adminClient
    .from("jobs")
    .update({
      dropbox_folder_path: provisioned.dropboxFolderPath,
      dropbox_folder_id: provisioned.dropboxFolderId,
      dropbox_setup_status: provisioned.dropboxSetupStatus,
    })
    .eq("id", job.id)
    .select(JOB_LIST_COLUMNS)
    .maybeSingle();

  if (error || !updatedJob) {
    return job;
  }

  return updatedJob as JobRecord;
}

function missingSchemaResult(): EnsureJobResult {
  return {
    job: null,
    created: false,
    dropboxReady: false,
    dropboxSetupStatus: "pending",
    schemaMissing: true,
    warning:
      "Production jobs are not configured yet. Apply the jobs migration in Supabase.",
  };
}

function isQuoteAccepted(quote: QuoteForJob, version: QuoteVersionForJob | null) {
  return (
    quote.status === "accepted" &&
    version?.version_status === "accepted"
  );
}

export async function ensureJobForAcceptedQuote({
  quoteId,
  actorProfileId,
}: {
  quoteId: string;
  actorProfileId?: string | null;
}): Promise<EnsureJobResult> {
  const adminClient = createAdminClient();

  const { data: existingJob, error: existingError } = await adminClient
    .from("jobs")
    .select(JOB_LIST_COLUMNS)
    .eq("quote_id", quoteId)
    .maybeSingle();

  if (existingError) {
    if (isMissingJobsSchemaError(existingError)) {
      if (process.env.NODE_ENV === "development") {
        console.error("[jobs] public.jobs is missing — apply supabase/migrations/20260802190000_jobs_foundation.sql", {
          quoteId,
          code: existingError.code,
          message: existingError.message,
        });
      }

      return missingSchemaResult();
    }

    throw new JobError(existingError.message, 500);
  }

  if (existingJob) {
    const job = await ensureDropboxOnExistingJob(
      adminClient,
      existingJob as JobRecord
    );

    return {
      job,
      created: false,
      dropboxReady: job.dropbox_setup_status === "ready",
      dropboxSetupStatus: job.dropbox_setup_status,
      schemaMissing: false,
      warning: null,
    };
  }

  const quote = await loadQuoteForJobCreation(adminClient, quoteId);

  if (!quote) {
    return missingSchemaResult();
  }

  const version = await loadCurrentQuoteVersion(adminClient, quote);

  if (!isQuoteAccepted(quote, version)) {
    return {
      job: null,
      created: false,
      dropboxReady: false,
      dropboxSetupStatus: "pending",
      schemaMissing: false,
      warning: "Quote is not accepted yet.",
    };
  }

  const quoteRequestId = await resolveQuoteRequestId(adminClient, quote);
  const requestContext = await loadQuoteRequestContext(
    adminClient,
    quoteRequestId
  );

  const jobReference = buildJobReference(quote.quote_number);
  const acceptedAt = version?.accepted_at ?? new Date().toISOString();

  const { data: createdJob, error: insertError } = await adminClient
    .from("jobs")
    .insert({
      company_id: quote.company_id,
      quote_id: quote.id,
      quote_version_id: version?.id ?? null,
      opportunity_id: quote.opportunity_id,
      quote_request_id: quoteRequestId,
      contact_id: quote.contact_id,
      job_reference: jobReference,
      project_name: quote.project_name,
      status: "awaiting_artwork",
      fulfilment_method: requestContext.fulfilment_method,
      required_date: requestContext.required_date,
      artwork_required: true,
      customer_visible: true,
      accepted_at: acceptedAt,
      accepted_by: actorProfileId ?? null,
      dropbox_folder_path: null,
      dropbox_folder_id: null,
      dropbox_setup_status: "pending",
    })
    .select(JOB_LIST_COLUMNS)
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: racedJob } = await adminClient
        .from("jobs")
        .select(JOB_LIST_COLUMNS)
        .eq("quote_id", quoteId)
        .maybeSingle();

      const job = racedJob
        ? await ensureDropboxOnExistingJob(adminClient, racedJob as JobRecord)
        : null;

      return {
        job,
        created: false,
        dropboxReady: job?.dropbox_setup_status === "ready",
        dropboxSetupStatus: job?.dropbox_setup_status ?? "pending",
        schemaMissing: false,
        warning: null,
      };
    }

    if (process.env.NODE_ENV === "development") {
      console.error("[jobs] insert failed for accepted quote", {
        quoteId,
        code: insertError.code,
        message: insertError.message,
        details: insertError.details,
        hint: insertError.hint,
      });
    }

    throw new JobError(insertError.message, 500);
  }

  let job = createdJob as JobRecord;

  const dropbox = await provisionDropboxForJob({
    jobReference,
    projectName: quote.project_name,
  });

  if (dropbox.dropboxReady) {
    const { data: updatedJob, error: dropboxUpdateError } = await adminClient
      .from("jobs")
      .update({
        dropbox_folder_path: dropbox.dropboxFolderPath,
        dropbox_folder_id: dropbox.dropboxFolderId,
        dropbox_setup_status: dropbox.dropboxSetupStatus,
      })
      .eq("id", job.id)
      .select(JOB_LIST_COLUMNS)
      .maybeSingle();

    if (dropboxUpdateError && process.env.NODE_ENV === "development") {
      console.error("[jobs] dropbox metadata update failed", {
        jobId: job.id,
        message: dropboxUpdateError.message,
      });
    }

    if (updatedJob) {
      job = updatedJob as JobRecord;
    }
  } else if (dropbox.dropboxSetupStatus === "failed") {
    await adminClient
      .from("jobs")
      .update({ dropbox_setup_status: "failed" })
      .eq("id", job.id);

    job = { ...job, dropbox_setup_status: "failed" };
  }

  try {
    await logJobCreatedFromAcceptedQuote({
      adminClient,
      quote,
      quoteRequestId,
      job,
      actorProfileId,
    });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("[jobs] failed to log job_created_from_accepted_quote", {
        quoteId,
        jobId: job.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  prepareQuoteAcceptedNotification({
    companyId: quote.company_id,
    quoteId: quote.id,
    jobId: job.id,
  });
  prepareJobCreatedNotification({
    companyId: quote.company_id,
    quoteId: quote.id,
    jobId: job.id,
    jobReference: job.job_reference,
  });

  if (job.artwork_required) {
    prepareArtworkRequestedNotification({
      companyId: quote.company_id,
      jobId: job.id,
      jobReference: job.job_reference,
    });
  }

  if (process.env.NODE_ENV === "development") {
    console.log("[jobs] created from accepted quote", {
      quoteId,
      jobId: job.id,
      jobReference,
      actorProfileId: actorProfileId ?? null,
      dropboxSetupStatus: job.dropbox_setup_status,
    });
  }

  return {
    job,
    created: true,
    dropboxReady: job.dropbox_setup_status === "ready",
    dropboxSetupStatus: job.dropbox_setup_status,
    schemaMissing: false,
    warning:
      job.dropbox_setup_status === "failed"
        ? "Job created but Dropbox folder setup failed. An admin can retry later."
        : job.dropbox_setup_status === "pending"
          ? "Job created. Dropbox folder setup is pending."
          : null,
  };
}

export async function reconcileJobForAcceptedQuote({
  quoteId,
  actorProfileId,
}: {
  quoteId: string;
  actorProfileId?: string | null;
}): Promise<EnsureJobResult> {
  const adminClient = createAdminClient();
  const quote = await loadQuoteForJobCreation(adminClient, quoteId);

  if (!quote) {
    return missingSchemaResult();
  }

  const version = await loadCurrentQuoteVersion(adminClient, quote);

  if (!isQuoteAccepted(quote, version)) {
    return {
      job: null,
      created: false,
      dropboxReady: false,
      dropboxSetupStatus: "pending",
      schemaMissing: false,
      warning: "Quote is not accepted.",
    };
  }

  return ensureJobForAcceptedQuote({ quoteId, actorProfileId });
}

export async function loadJobIdForQuote(
  adminClient: SupabaseClient,
  quoteId: string
): Promise<string | null> {
  const { data, error } = await adminClient
    .from("jobs")
    .select("id")
    .eq("quote_id", quoteId)
    .maybeSingle();

  if (error) {
    if (isMissingJobsSchemaError(error)) {
      return null;
    }

    throw new JobError(error.message, 500);
  }

  return data?.id ?? null;
}

export async function retryDropboxSetupForJob(jobId: string) {
  const adminClient = createAdminClient();

  const { data: job, error } = await adminClient
    .from("jobs")
    .select(JOB_LIST_COLUMNS)
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw new JobError(error.message, 500);
  }

  if (!job) {
    throw new JobError("Job not found.", 404);
  }

  if (!isDropboxConfigured()) {
    throw new JobError(
      "Dropbox integration is not configured. Set DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN, and DROPBOX_ROOT_FOLDER.",
      503
    );
  }

  const updatedJob = await ensureDropboxOnExistingJob(adminClient, job as JobRecord);

  return {
    job: updatedJob,
    dropboxReady:
      updatedJob.dropbox_setup_status === "ready" &&
      Boolean(updatedJob.dropbox_folder_path),
  };
}
