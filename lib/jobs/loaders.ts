import type { SupabaseClient } from "@supabase/supabase-js";

import { isDropboxConfigured } from "@/lib/dropbox/client";
import {
  CUSTOMER_ARTWORK_STATUS_LABELS,
  JOB_STATUS_LABELS,
} from "@/lib/jobs/constants";
import {
  getCustomerChangesRequiredComment,
  jobNeedsArtworkUpload,
  resolveCustomerJobStatus,
} from "@/lib/jobs/customer-status";
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
  quoteNumber: number | null,
  files: JobFileRecord[]
): CustomerJobRecord {
  const statusView = resolveCustomerJobStatus(job, files);

  return {
    id: job.id,
    reference: job.job_reference,
    projectTitle: job.project_name,
    status: statusView.status,
    statusLabel: statusView.statusLabel,
    requiredDate: job.required_date,
    fulfilmentMethod: job.fulfilment_method,
    quoteId: job.quote_id,
    quoteNumber: quoteNumber ? `Q-${quoteNumber}` : null,
    artworkRequired: job.artwork_required,
    needsArtworkUpload: jobNeedsArtworkUpload(job, files),
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
  const jobIds = jobs.map((job) => job.id);

  const [{ data: quotes }, { data: files }] = await Promise.all([
    quoteIds.length > 0
      ? adminClient.from("quotes").select("id, quote_number").in("id", quoteIds)
      : Promise.resolve({ data: [] as { id: string; quote_number: number }[] }),
    jobIds.length > 0
      ? adminClient
          .from("job_files")
          .select("id, job_id, upload_status, artwork_status, version_number, deleted_at")
          .in("job_id", jobIds)
          .is("deleted_at", null)
      : Promise.resolve({ data: [] as JobFileRecord[] }),
  ]);

  const quoteNumberById = new Map(
    (quotes ?? []).map((quote) => [quote.id, quote.quote_number])
  );

  const filesByJobId = new Map<string, JobFileRecord[]>();
  for (const file of (files ?? []) as JobFileRecord[]) {
    const existing = filesByJobId.get(file.job_id) ?? [];
    existing.push(file);
    filesByJobId.set(file.job_id, existing);
  }

  return {
    jobs: jobs.map((job) =>
      mapJobToCustomerListRecord(
        job,
        quoteNumberById.get(job.quote_id) ?? null,
        filesByJobId.get(job.id) ?? []
      )
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
  const typedFiles = (files ?? []) as JobFileRecord[];
  const statusView = resolveCustomerJobStatus(typedJob, typedFiles);

  let deliveryDetails: string | null = null;

  if (typedJob.fulfilment_method === "delivery" && typedJob.quote_request_id) {
    const { data: quoteRequest } = await adminClient
      .from("quote_requests")
      .select(
        "delivery_address_line_1, delivery_address_line_2, delivery_city, delivery_postcode, delivery_contact_name, delivery_contact_phone"
      )
      .eq("id", typedJob.quote_request_id)
      .maybeSingle();

    if (quoteRequest) {
      const address = [
        quoteRequest.delivery_address_line_1,
        quoteRequest.delivery_address_line_2,
        quoteRequest.delivery_city,
        quoteRequest.delivery_postcode,
      ]
        .filter(Boolean)
        .join(", ");

      const contact = [quoteRequest.delivery_contact_name, quoteRequest.delivery_contact_phone]
        .filter(Boolean)
        .join(" · ");

      deliveryDetails = [address, contact].filter(Boolean).join(" — ") || null;
    }
  }

  return {
    id: typedJob.id,
    reference: typedJob.job_reference,
    projectTitle: typedJob.project_name,
    status: statusView.status,
    statusLabel: statusView.statusLabel,
    requiredDate: typedJob.required_date,
    fulfilmentMethod: typedJob.fulfilment_method,
    deliveryDetails,
    quoteId: typedJob.quote_id,
    quoteNumber: quote?.quote_number ? `Q-${quote.quote_number}` : null,
    artworkRequired: typedJob.artwork_required,
    needsArtworkUpload: jobNeedsArtworkUpload(typedJob, typedFiles),
    changesRequiredComment: getCustomerChangesRequiredComment(typedFiles),
    dropboxConfigured: isDropboxConfigured(),
    files: typedFiles.map((file) =>
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
