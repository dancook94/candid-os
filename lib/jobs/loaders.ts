import type { SupabaseClient } from "@supabase/supabase-js";

import { isDropboxConfigured } from "@/lib/dropbox/client";
import {
  CUSTOMER_ARTWORK_STATUS_LABELS,
  JOB_STATUS_LABELS,
} from "@/lib/jobs/constants";
import { isMissingJobsSchemaError } from "@/lib/jobs/errors";
import { JOB_LIST_COLUMNS } from "@/lib/jobs/job-select";
import type {
  CustomerJobDetail,
  CustomerJobFileView,
  JobFileRecord,
  JobRecord,
} from "@/lib/jobs/types";
import type { CustomerJobRecord } from "@/lib/customer-jobs";
import { createAdminClient } from "@/lib/supabase/admin";

function mapJobToCustomerListRecord(
  job: JobRecord,
  quoteNumber: number | null
): CustomerJobRecord {
  return {
    id: job.id,
    reference: job.job_reference,
    projectTitle: job.project_name,
    status: job.status,
    statusLabel: JOB_STATUS_LABELS[job.status] ?? job.status,
    requiredDate: job.required_date,
    fulfilmentMethod: job.fulfilment_method,
    quoteId: job.quote_id,
    quoteNumber: quoteNumber ? `Q-${quoteNumber}` : null,
    updatedAt: job.updated_at,
  };
}

function mapJobFileToCustomerView(
  file: JobFileRecord,
  uploadedByName: string | null
): CustomerJobFileView {
  const canModify =
    file.upload_status === "complete" &&
    (file.artwork_status === "uploaded" ||
      file.artwork_status === "changes_required");

  return {
    id: file.id,
    fileName: file.file_name,
    originalFileName: file.original_file_name,
    fileSizeBytes: file.file_size_bytes,
    mimeType: file.mime_type,
    uploadStatus: file.upload_status,
    artworkStatus: file.artwork_status,
    customerNotes: file.customer_notes,
    versionNumber: file.version_number,
    uploadedAt: file.uploaded_at,
    uploadedByName,
    canRemove: canModify,
    canReplace: canModify,
  };
}

export async function loadCustomerJobs(
  supabase: SupabaseClient,
  companyId: string,
  options: { filter?: string } = {}
) {
  const adminClient = createAdminClient();

  let query = adminClient
    .from("jobs")
    .select(JOB_LIST_COLUMNS)
    .eq("company_id", companyId)
    .eq("customer_visible", true)
    .order("updated_at", { ascending: false });

  if (options.filter && options.filter !== "all") {
    if (options.filter === "active") {
      query = query.in("status", ["awaiting_artwork", "in_production", "ready"]);
    } else {
      query = query.eq("status", options.filter);
    }
  }

  const { data, error } = await query;

  if (error) {
    if (isMissingJobsSchemaError(error)) {
      return {
        jobs: [] as CustomerJobRecord[],
        jobsDataAvailable: false,
        loadError: null as string | null,
      };
    }

    return {
      jobs: [] as CustomerJobRecord[],
      jobsDataAvailable: false,
      loadError: error.message,
    };
  }

  const jobs = (data ?? []) as JobRecord[];
  const quoteIds = jobs.map((job) => job.quote_id);

  const { data: quotes } =
    quoteIds.length > 0
      ? await adminClient
          .from("quotes")
          .select("id, quote_number")
          .in("id", quoteIds)
      : { data: [] as { id: string; quote_number: number }[] };

  const quoteNumberById = new Map(
    (quotes ?? []).map((quote) => [quote.id, quote.quote_number])
  );

  return {
    jobs: jobs.map((job) =>
      mapJobToCustomerListRecord(job, quoteNumberById.get(job.quote_id) ?? null)
    ),
    jobsDataAvailable: true,
    loadError: null as string | null,
  };
}

export async function loadCustomerJobDetail(
  supabase: SupabaseClient,
  companyId: string,
  jobId: string
): Promise<CustomerJobDetail | null> {
  const adminClient = createAdminClient();

  const { data: job, error: jobError } = await adminClient
    .from("jobs")
    .select(JOB_LIST_COLUMNS)
    .eq("id", jobId)
    .eq("company_id", companyId)
    .eq("customer_visible", true)
    .maybeSingle();

  if (jobError) {
    if (isMissingJobsSchemaError(jobError)) {
      return null;
    }

    throw jobError;
  }

  if (!job) {
    return null;
  }

  const [{ data: quote }, { data: files }] = await Promise.all([
    adminClient.from("quotes").select("id, quote_number").eq("id", job.quote_id).maybeSingle(),
    adminClient
      .from("job_files")
      .select("*")
      .eq("job_id", job.id)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const uploaderIds = [
    ...new Set((files ?? []).map((file) => file.uploaded_by_profile_id)),
  ];

  const { data: uploaders } =
    uploaderIds.length > 0
      ? await adminClient.from("profiles").select("id, full_name").in("id", uploaderIds)
      : { data: [] as { id: string; full_name: string | null }[] };

  const uploaderNameById = new Map(
    (uploaders ?? []).map((profile) => [profile.id, profile.full_name])
  );

  const typedJob = job as JobRecord;

  return {
    id: typedJob.id,
    reference: typedJob.job_reference,
    projectTitle: typedJob.project_name,
    status: typedJob.status,
    statusLabel: JOB_STATUS_LABELS[typedJob.status] ?? typedJob.status,
    requiredDate: typedJob.required_date,
    fulfilmentMethod: typedJob.fulfilment_method,
    quoteId: typedJob.quote_id,
    quoteNumber: quote?.quote_number ? `Q-${quote.quote_number}` : null,
    artworkRequired: typedJob.artwork_required,
    dropboxConfigured: isDropboxConfigured(),
    files: ((files ?? []) as JobFileRecord[]).map((file) =>
      mapJobFileToCustomerView(
        file,
        uploaderNameById.get(file.uploaded_by_profile_id) ?? null
      )
    ),
  };
}

export function getCustomerArtworkStatusLabel(status: string) {
  return CUSTOMER_ARTWORK_STATUS_LABELS[status] ?? status;
}

export async function loadAdminJobDetail(adminClient: SupabaseClient, jobId: string) {
  const { data: job, error } = await adminClient
    .from("jobs")
    .select(JOB_LIST_COLUMNS)
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    if (isMissingJobsSchemaError(error)) {
      return null;
    }

    throw error;
  }

  if (!job) {
    return null;
  }

  const typedJob = job as JobRecord;

  const [{ data: company }, { data: quote }, { data: files }, { data: opportunity }] =
    await Promise.all([
      adminClient
        .from("companies")
        .select("company_name")
        .eq("id", typedJob.company_id)
        .maybeSingle(),
      adminClient
        .from("quotes")
        .select("id, quote_number")
        .eq("id", typedJob.quote_id)
        .maybeSingle(),
      adminClient
        .from("job_files")
        .select("*")
        .eq("job_id", typedJob.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      typedJob.opportunity_id
        ? adminClient
            .from("opportunities")
            .select("id, title")
            .eq("id", typedJob.opportunity_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const uploaderIds = [
    ...new Set((files ?? []).map((file) => file.uploaded_by_profile_id)),
  ];

  const { data: uploaders } =
    uploaderIds.length > 0
      ? await adminClient.from("profiles").select("id, full_name").in("id", uploaderIds)
      : { data: [] as { id: string; full_name: string | null }[] };

  const uploaderNameById = new Map(
    (uploaders ?? []).map((profile) => [profile.id, profile.full_name])
  );

  return {
    job: typedJob,
    companyName: company?.company_name ?? "Unknown company",
    quoteNumber: quote?.quote_number ?? null,
    opportunityTitle: opportunity?.title ?? null,
    files: ((files ?? []) as JobFileRecord[]).map((file) => ({
      ...file,
      uploadedByName: uploaderNameById.get(file.uploaded_by_profile_id) ?? null,
      artworkStatusLabel:
        CUSTOMER_ARTWORK_STATUS_LABELS[file.artwork_status] ?? file.artwork_status,
    })),
  };
}
