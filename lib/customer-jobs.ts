import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Customer-visible production job statuses once the jobs schema exists.
 * Filters are hidden in the portal until jobsDataAvailable is true.
 */
export const CUSTOMER_JOB_STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "awaiting_artwork", label: "Awaiting artwork" },
  { id: "in_production", label: "In production" },
  { id: "ready", label: "Ready" },
  { id: "completed", label: "Completed" },
] as const;

export type CustomerJobStatusFilterId =
  (typeof CUSTOMER_JOB_STATUS_FILTERS)[number]["id"];

export type CustomerJobRecord = {
  id: string;
  reference: string;
  projectTitle: string;
  status: string;
  statusLabel: string;
  requiredDate: string | null;
  fulfilmentMethod: string | null;
  quoteId: string | null;
  quoteNumber: string | null;
  updatedAt: string;
};

export type LoadCustomerJobsResult = {
  jobs: CustomerJobRecord[];
  /** False until a customer-safe jobs/orders table and RLS policies exist. */
  jobsDataAvailable: boolean;
};

type LoadCustomerJobsOptions = {
  filter?: CustomerJobStatusFilterId;
};

/**
 * Loads customer-safe production jobs for an approved company.
 *
 * Schema note: no public.jobs (or equivalent) table exists yet. Accepted quotes
 * are not automatically converted into production records. When a jobs table
 * lands, query it here with company_id from the server profile — never from
 * the browser — and select only customer-safe columns.
 */
export async function loadCustomerJobs(
  _supabase: SupabaseClient,
  _companyId: string,
  _options: LoadCustomerJobsOptions = {}
): Promise<LoadCustomerJobsResult> {
  return {
    jobs: [],
    jobsDataAvailable: false,
  };
}

export function filterCustomerJobsByStatus(
  jobs: CustomerJobRecord[],
  filter: CustomerJobStatusFilterId
) {
  if (filter === "all") {
    return jobs;
  }

  return jobs.filter((job) => job.status === filter);
}
