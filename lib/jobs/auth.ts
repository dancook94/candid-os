import type { SupabaseClient, User } from "@supabase/supabase-js";

import { requireCustomerSettingsContext } from "@/lib/customer-settings/auth";
import { JobError } from "@/lib/jobs/errors";
import { JOB_LIST_COLUMNS } from "@/lib/jobs/job-select";
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
    .select(JOB_LIST_COLUMNS)
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

  if (!job.customer_visible) {
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
    .select(JOB_LIST_COLUMNS)
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
