import type { SupabaseClient } from "@supabase/supabase-js";

import { isMissingJobsSchemaError } from "@/lib/jobs/errors";
import { reconcileJobForAcceptedQuote } from "@/lib/jobs/create-from-quote";
import { JOB_LIST_COLUMNS } from "@/lib/jobs/job-select";

export type AdminJobMetrics = {
  artworkRequiredCount: number;
  schemaMissing: boolean;
  errors: string[];
};

export async function fetchAdminJobMetrics(
  supabase: SupabaseClient
): Promise<AdminJobMetrics> {
  const errors: string[] = [];

  const { count, error } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "awaiting_artwork")
    .eq("artwork_required", true);

  if (error) {
    if (isMissingJobsSchemaError(error)) {
      return {
        artworkRequiredCount: 0,
        schemaMissing: true,
        errors,
      };
    }

    errors.push(`Jobs awaiting artwork: ${error.message}`);

    return {
      artworkRequiredCount: 0,
      schemaMissing: false,
      errors,
    };
  }

  return {
    artworkRequiredCount: count ?? 0,
    schemaMissing: false,
    errors,
  };
}

export async function loadLinkedJobForQuote(quoteId: string, quoteStatus: string) {
  if (quoteStatus !== "accepted") {
    return {
      linkedJobId: null as string | null,
      linkedJobReference: null as string | null,
      schemaMissing: false,
    };
  }

  const result = await reconcileJobForAcceptedQuote({ quoteId });

  return {
    linkedJobId: result.job?.id ?? null,
    linkedJobReference: result.job?.job_reference ?? null,
    schemaMissing: result.schemaMissing,
  };
}

export async function loadJobSummaryByQuoteId(
  supabase: SupabaseClient,
  quoteId: string
) {
  const { data, error } = await supabase
    .from("jobs")
    .select(JOB_LIST_COLUMNS)
    .eq("quote_id", quoteId)
    .maybeSingle();

  if (error) {
    if (isMissingJobsSchemaError(error)) {
      return { job: null, schemaMissing: true };
    }

    throw error;
  }

  return { job: data, schemaMissing: false };
}
