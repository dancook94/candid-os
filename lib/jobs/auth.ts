import type { SupabaseClient, User } from "@supabase/supabase-js";

import { requireCustomerSettingsContext } from "@/lib/customer-settings/auth";
import { JobError } from "@/lib/jobs/errors";
import type { JobFileRecord, JobRecord } from "@/lib/jobs/types";
import { createAdminClient } from "@/lib/supabase/admin";

export type CustomerJobContext = Awaited<
  ReturnType<typeof requireCustomerSettingsContext>
> & {
  job: JobRecord;
};

export async function requireCustomerJobContext(
  supabase: SupabaseClient,
  user: User,
  jobId: string
): Promise<CustomerJobContext> {
  const context = await requireCustomerSettingsContext(supabase, user);
  const adminClient = createAdminClient();

  const { data: job, error } = await adminClient
    .from("jobs")
    .select(
      "id, company_id, quote_id, opportunity_id, job_reference, project_name, status, fulfilment_method, required_date, dropbox_folder_path, dropbox_folder_id, created_at, updated_at"
    )
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw new JobError(error.message, 500);
  }

  if (!job) {
    throw new JobError("Job not found.", 404);
  }

  if (job.company_id !== context.company.id) {
    throw new JobError("Forbidden.", 403);
  }

  return {
    ...context,
    job: job as JobRecord,
  };
}

export async function loadCustomerOwnedJobFile(
  adminClient: SupabaseClient,
  job: JobRecord,
  fileId: string
) {
  const { data: file, error } = await adminClient
    .from("job_files")
    .select("*")
    .eq("id", fileId)
    .eq("job_id", job.id)
    .eq("company_id", job.company_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new JobError(error.message, 500);
  }

  if (!file) {
    throw new JobError("Artwork file not found.", 404);
  }

  return file as JobFileRecord;
}

export async function requireAdminJobAccess(
  adminClient: SupabaseClient,
  jobId: string
) {
  const { data: job, error } = await adminClient
    .from("jobs")
    .select(
      "id, company_id, quote_id, opportunity_id, job_reference, project_name, status, fulfilment_method, required_date, dropbox_folder_path, dropbox_folder_id, created_at, updated_at"
    )
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw new JobError(error.message, 500);
  }

  if (!job) {
    throw new JobError("Job not found.", 404);
  }

  return job as JobRecord;
}
