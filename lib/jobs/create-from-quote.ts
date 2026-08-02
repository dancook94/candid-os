import type { SupabaseClient } from "@supabase/supabase-js";

import { isDropboxConfigured } from "@/lib/dropbox/client";
import { ensureJobDropboxFolders } from "@/lib/dropbox/job-folders";
import { isMissingJobsSchemaError, JobError } from "@/lib/jobs/errors";
import type { JobRecord } from "@/lib/jobs/types";
import { createAdminClient } from "@/lib/supabase/admin";

type QuoteForJob = {
  id: string;
  company_id: string;
  quote_number: number;
  project_name: string;
  opportunity_id: string | null;
  quote_request_id: string | null;
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
    .select("id, company_id, quote_number, project_name, opportunity_id, quote_request_id")
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

export async function ensureJobForAcceptedQuote({
  quoteId,
  actorProfileId,
}: {
  quoteId: string;
  actorProfileId?: string | null;
}): Promise<{ job: JobRecord | null; created: boolean; dropboxReady: boolean }> {
  const adminClient = createAdminClient();

  const { data: existingJob, error: existingError } = await adminClient
    .from("jobs")
    .select(
      "id, company_id, quote_id, opportunity_id, job_reference, project_name, status, fulfilment_method, required_date, dropbox_folder_path, dropbox_folder_id, created_at, updated_at"
    )
    .eq("quote_id", quoteId)
    .maybeSingle();

  if (existingError) {
    if (isMissingJobsSchemaError(existingError)) {
      return { job: null, created: false, dropboxReady: false };
    }

    throw new JobError(existingError.message, 500);
  }

  if (existingJob) {
    return {
      job: existingJob as JobRecord,
      created: false,
      dropboxReady: Boolean(existingJob.dropbox_folder_path),
    };
  }

  const quote = await loadQuoteForJobCreation(adminClient, quoteId);
  if (!quote) {
    return { job: null, created: false, dropboxReady: false };
  }

  const requestContext = await loadQuoteRequestContext(
    adminClient,
    quote.quote_request_id
  );

  const jobReference = buildJobReference(quote.quote_number);
  let dropboxFolderPath = "";
  let dropboxFolderId: string | null = null;
  let dropboxReady = false;

  if (isDropboxConfigured()) {
    const folders = await ensureJobDropboxFolders({
      jobReference,
      projectName: quote.project_name,
    });
    dropboxFolderPath = folders.rootPath;
    dropboxFolderId = folders.rootFolderId;
    dropboxReady = true;
  }

  const { data: createdJob, error: insertError } = await adminClient
    .from("jobs")
    .insert({
      company_id: quote.company_id,
      quote_id: quote.id,
      opportunity_id: quote.opportunity_id,
      job_reference: jobReference,
      project_name: quote.project_name,
      status: "awaiting_artwork",
      fulfilment_method: requestContext.fulfilment_method,
      required_date: requestContext.required_date,
      dropbox_folder_path: dropboxFolderPath,
      dropbox_folder_id: dropboxFolderId,
    })
    .select(
      "id, company_id, quote_id, opportunity_id, job_reference, project_name, status, fulfilment_method, required_date, dropbox_folder_path, dropbox_folder_id, created_at, updated_at"
    )
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: racedJob } = await adminClient
        .from("jobs")
        .select(
          "id, company_id, quote_id, opportunity_id, job_reference, project_name, status, fulfilment_method, required_date, dropbox_folder_path, dropbox_folder_id, created_at, updated_at"
        )
        .eq("quote_id", quoteId)
        .maybeSingle();

      return {
        job: (racedJob as JobRecord | null) ?? null,
        created: false,
        dropboxReady: Boolean(racedJob?.dropbox_folder_path),
      };
    }

    throw new JobError(insertError.message, 500);
  }

  if (process.env.NODE_ENV === "development") {
    console.log("[jobs] created from accepted quote", {
      quoteId,
      jobId: createdJob.id,
      jobReference,
      actorProfileId: actorProfileId ?? null,
      dropboxReady,
    });
  }

  return {
    job: createdJob as JobRecord,
    created: true,
    dropboxReady,
  };
}
