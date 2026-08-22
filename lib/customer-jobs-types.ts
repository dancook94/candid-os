import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Customer-visible production job statuses once the jobs schema exists.
 * Filters are hidden in the portal until jobsDataAvailable is true.
 */
export const CUSTOMER_JOB_STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "awaiting_artwork", label: "Awaiting artwork" },
  { id: "artwork_in_preparation", label: "Artwork in preparation" },
  { id: "artwork_received", label: "Artwork received" },
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
  artworkRequired: boolean;
  needsArtworkUpload: boolean;
  updatedAt: string;
  proofStatus: string;
  proofStatusLabel: string;
  proofRequiresAction: boolean;
  proofActionLabel: string | null;
  proofActionUrl: string | null;
  proofAwaitingApprovalCount: number;
};

export type LoadCustomerJobsResult = {
  jobs: CustomerJobRecord[];
  /** False until a customer-safe jobs table and RLS policies exist. */
  jobsDataAvailable: boolean;
  loadError: string | null;
};

export function filterCustomerJobsByStatus(
  jobs: CustomerJobRecord[],
  filter: CustomerJobStatusFilterId
) {
  if (filter === "all") {
    return jobs;
  }

  return jobs.filter((job) => job.status === filter);
}
