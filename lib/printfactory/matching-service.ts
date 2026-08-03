import type { SupabaseClient } from "@supabase/supabase-js";

import {
  clearAutomaticJobMatch,
  confirmSuggestedJobMatch,
  ignorePrintfactoryJobAsHistorical,
  matchPrintfactoryJobToCandidJob,
  shouldPreserveExistingJobMatch,
} from "@/lib/printfactory/job-matching";
import {
  hasAmbiguousItemSuggestions,
  suggestManifestItemMatches,
  type ManifestItemMatchCandidate,
} from "@/lib/printfactory/item-matching";
import { MANIFEST_ITEM_SELECT } from "@/lib/manifest/constants";
import { refreshJobProductionReadiness } from "@/lib/printfactory/readiness-service";

export async function rematchPrintfactoryJob(
  adminClient: SupabaseClient,
  printfactoryJobId: string,
  actorProfileId?: string | null
) {
  const { data: row, error } = await adminClient
    .from("printfactory_jobs")
    .select("*")
    .eq("id", printfactoryJobId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!row) {
    throw new Error("PrintFactory record not found.");
  }

  if (shouldPreserveExistingJobMatch(row.job_match_status as string)) {
    return { row, skipped: true as const };
  }

  const match = await matchPrintfactoryJobToCandidJob(adminClient, {
    sourceFilePath: row.source_file_path as string | null,
    sourceFileName: row.source_file_name as string | null,
    jobName: row.job_name as string | null,
    documentName: (row.document_name as string | null) ?? null,
  });

  const { data: updated, error: updateError } = await adminClient
    .from("printfactory_jobs")
    .update({
      candid_job_id: match.candidJobId,
      suggested_candid_job_id: match.suggestedCandidJobId,
      job_match_status: match.jobMatchStatus,
      job_match_method: match.jobMatchMethod,
      job_match_confidence: match.jobMatchConfidence,
      extracted_job_reference: match.extractedJobReference,
      match_suggestion_reason: match.matchSuggestionReason,
      match_suggestion_details: match.matchSuggestionDetails,
    })
    .eq("id", printfactoryJobId)
    .select("*")
    .single();

  if (updateError) {
    throw updateError;
  }

  await createItemSuggestionsForJob(adminClient, updated as Record<string, unknown>);

  const candidJobId = updated.candid_job_id as string | null;

  if (candidJobId) {
    await refreshJobProductionReadiness(adminClient, candidJobId, actorProfileId);
  }

  return { row: updated, skipped: false as const };
}

export async function bulkRematchPrintfactoryJobs(
  adminClient: SupabaseClient,
  printfactoryJobIds: string[],
  actorProfileId?: string | null
) {
  let rematched = 0;
  let skipped = 0;

  for (const id of printfactoryJobIds) {
    const result = await rematchPrintfactoryJob(adminClient, id, actorProfileId);
    if (result.skipped) {
      skipped += 1;
    } else {
      rematched += 1;
    }
  }

  return { rematched, skipped };
}

export async function bulkConfirmHighConfidenceJobSuggestions(
  adminClient: SupabaseClient,
  actorProfileId: string
) {
  const { data: rows, error } = await adminClient
    .from("printfactory_jobs")
    .select("id, suggested_candid_job_id, job_match_status, job_match_confidence, match_suggestion_details")
    .eq("job_match_status", "suggested")
    .not("suggested_candid_job_id", "is", null);

  if (error) {
    throw error;
  }

  let confirmed = 0;

  for (const row of rows ?? []) {
    const details = row.match_suggestion_details as {
      confidenceLevel?: string;
    } | null;

    const isExactRef =
      (row.job_match_confidence as number | null) === 1 ||
      details?.confidenceLevel === "high";

    if (!isExactRef) {
      continue;
    }

    await confirmSuggestedJobMatch(
      adminClient,
      row.id as string,
      row.suggested_candid_job_id as string,
      actorProfileId
    );
    confirmed += 1;
  }

  return { confirmed };
}

export async function bulkIgnoreHistoricalPrintfactoryJobs(
  adminClient: SupabaseClient,
  printfactoryJobIds: string[],
  actorProfileId: string,
  cutoffDate?: string | null
) {
  let ignored = 0;

  for (const id of printfactoryJobIds) {
    await ignorePrintfactoryJobAsHistorical(
      adminClient,
      id,
      actorProfileId,
      cutoffDate
    );
    ignored += 1;
  }

  return { ignored };
}

export async function bulkClearAutomaticMatches(
  adminClient: SupabaseClient,
  printfactoryJobIds: string[]
) {
  let cleared = 0;

  for (const id of printfactoryJobIds) {
    try {
      await clearAutomaticJobMatch(adminClient, id);
      cleared += 1;
    } catch {
      // Skip manually matched records.
    }
  }

  return { cleared };
}

export async function createItemSuggestionsForJob(
  adminClient: SupabaseClient,
  printfactoryJob: Record<string, unknown>
) {
  const candidJobId = printfactoryJob.candid_job_id as string | null;
  const printfactoryJobId = printfactoryJob.id as string;

  if (!candidJobId) {
    return 0;
  }

  const matchStatus = printfactoryJob.job_match_status as string;

  if (
    matchStatus === "ignored" ||
    matchStatus === "unmatched" ||
    matchStatus === "conflict"
  ) {
    return 0;
  }

  const { data: manifestItems, error: manifestError } = await adminClient
    .from("production_items")
    .select(MANIFEST_ITEM_SELECT)
    .eq("job_id", candidJobId)
    .is("deleted_at", null);

  if (manifestError) {
    throw manifestError;
  }

  const { data: confirmedLinks, error: linksError } = await adminClient
    .from("printfactory_job_manifest_items")
    .select("production_item_id, printfactory_jobs!inner(source_file_name)")
    .eq("link_status", "confirmed");

  if (linksError && linksError.code !== "42P01") {
    throw linksError;
  }

  const priorPatterns = (confirmedLinks ?? []).map((link) => ({
    productionItemId: link.production_item_id as string,
    filenamePattern:
      ((link.printfactory_jobs as { source_file_name?: string | null })
        ?.source_file_name ?? "") || "",
  }));

  const suggestions = suggestManifestItemMatches(
    {
      source_file_path: printfactoryJob.source_file_path as string | null,
      source_file_name: printfactoryJob.source_file_name as string | null,
      job_name: printfactoryJob.job_name as string | null,
      document_name: printfactoryJob.document_name as string | null,
      media_type: printfactoryJob.media_type as string | null,
    },
    (manifestItems ?? []) as ManifestItemMatchCandidate[],
    priorPatterns
  );

  if (hasAmbiguousItemSuggestions(suggestions)) {
    return 0;
  }

  let created = 0;

  for (const suggestion of suggestions.slice(0, 5)) {
    const { data: existingLink } = await adminClient
      .from("printfactory_job_manifest_items")
      .select("id, link_status")
      .eq("printfactory_job_id", printfactoryJobId)
      .eq("production_item_id", suggestion.productionItemId)
      .maybeSingle();

    if (existingLink?.link_status === "confirmed") {
      continue;
    }

    const { error } = await adminClient
      .from("printfactory_job_manifest_items")
      .upsert(
        {
          printfactory_job_id: printfactoryJobId,
          production_item_id: suggestion.productionItemId,
          link_status: "suggested",
          match_method: suggestion.matchMethod,
          match_confidence: suggestion.confidence,
          suggestion_reason: suggestion.reason,
          suggestion_details: { reasons: suggestion.reasons },
        },
        { onConflict: "printfactory_job_id,production_item_id" }
      );

    if (error) {
      throw error;
    }

    created += 1;
  }

  return created;
}
