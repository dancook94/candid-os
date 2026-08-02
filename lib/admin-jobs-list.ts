import type { SupabaseClient } from "@supabase/supabase-js";

import { isMissingJobsSchemaError } from "@/lib/jobs/errors";
import { JOB_LIST_COLUMNS } from "@/lib/jobs/job-select";
import { resolveJobStatusView } from "@/lib/jobs/status";
import type { JobRecord } from "@/lib/jobs/types";
import { createAdminClient } from "@/lib/supabase/admin";

export type AdminJobListRow = {
  id: string;
  reference: string;
  projectTitle: string;
  status: string;
  statusLabel: string;
  companyId: string;
  companyName: string;
  quoteId: string;
  quoteNumber: string | null;
  artworkRequired: boolean;
  dropboxSetupStatus: string;
  updatedAt: string;
};

export type AdminJobsListResult = {
  jobs: AdminJobListRow[];
  schemaMissing: boolean;
  loadError: string | null;
};

export async function fetchAdminJobsList(
  _supabase: SupabaseClient
): Promise<AdminJobsListResult> {
  const adminClient = createAdminClient();

  const { data, error } = await adminClient
    .from("jobs")
    .select(JOB_LIST_COLUMNS)
    .order("updated_at", { ascending: false });

  if (error) {
    if (isMissingJobsSchemaError(error)) {
      return { jobs: [], schemaMissing: true, loadError: null };
    }

    return { jobs: [], schemaMissing: false, loadError: error.message };
  }

  const jobs = (data ?? []) as JobRecord[];
  const companyIds = [...new Set(jobs.map((job) => job.company_id))];
  const quoteIds = [...new Set(jobs.map((job) => job.quote_id))];

  const [{ data: companies }, { data: quotes }] = await Promise.all([
    companyIds.length > 0
      ? adminClient.from("companies").select("id, company_name").in("id", companyIds)
      : Promise.resolve({ data: [] as { id: string; company_name: string }[] }),
    quoteIds.length > 0
      ? adminClient.from("quotes").select("id, quote_number").in("id", quoteIds)
      : Promise.resolve({ data: [] as { id: string; quote_number: number }[] }),
  ]);

  const companyNameById = new Map(
    (companies ?? []).map((company) => [company.id, company.company_name])
  );
  const quoteNumberById = new Map(
    (quotes ?? []).map((quote) => [quote.id, quote.quote_number])
  );

  return {
    jobs: jobs.map((job) => {
      const statusView = resolveJobStatusView(job);

      return {
        id: job.id,
        reference: job.job_reference,
        projectTitle: job.project_name,
        status: statusView.status,
        statusLabel: statusView.statusLabel,
        companyId: job.company_id,
        companyName: companyNameById.get(job.company_id) ?? "Unknown company",
        quoteId: job.quote_id,
        quoteNumber: quoteNumberById.has(job.quote_id)
          ? `Q-${quoteNumberById.get(job.quote_id)}`
          : null,
        artworkRequired: job.artwork_required,
        dropboxSetupStatus: job.dropbox_setup_status,
        updatedAt: job.updated_at,
      };
    }),
    schemaMissing: false,
    loadError: null,
  };
}
