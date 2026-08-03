import type { SupabaseClient } from "@supabase/supabase-js";

import type { JobMatchResult } from "@/lib/printfactory/job-matching";
import {
  extractConflictingJobReferences,
  extractPrimaryJobReference,
  type PrintfactoryReferenceSearchInput,
} from "@/lib/printfactory/job-reference-parser";

type StoredPathMapping = {
  pathPrefix: string;
  candidJobId: string;
  jobReference: string;
};

type StoredTextMapping = {
  mappingType: string;
  pattern: string;
  candidJobId: string;
  jobReference: string;
};

export type JobMatchingContext = {
  jobsByReference: Map<string, { id: string; jobReference: string }>;
  pathMappings: StoredPathMapping[];
  textMappings: StoredTextMapping[];
};

export async function loadJobMatchingContext(
  adminClient: SupabaseClient
): Promise<JobMatchingContext> {
  const [jobsResult, pathResult, textResult] = await Promise.all([
    adminClient
      .from("jobs")
      .select("id, job_reference, status")
      .neq("status", "cancelled"),
    adminClient
      .from("printfactory_path_prefix_mappings")
      .select("path_prefix, candid_job_id, jobs!inner(id, job_reference)")
      .order("path_prefix", { ascending: false }),
    adminClient
      .from("printfactory_stored_text_mappings")
      .select("mapping_type, pattern, candid_job_id, jobs!inner(id, job_reference)")
      .order("pattern", { ascending: false }),
  ]);

  if (jobsResult.error) {
    throw jobsResult.error;
  }

  const jobsByReference = new Map<string, { id: string; jobReference: string }>();

  for (const job of jobsResult.data ?? []) {
    jobsByReference.set(String(job.job_reference).toUpperCase(), {
      id: job.id as string,
      jobReference: job.job_reference as string,
    });
  }

  const pathMappings: StoredPathMapping[] = [];

  if (!pathResult.error || pathResult.error.code === "42P01") {
    for (const row of pathResult.data ?? []) {
      const job = extractJob(row.jobs);
      if (!job) continue;
      pathMappings.push({
        pathPrefix: String(row.path_prefix),
        candidJobId: job.id,
        jobReference: job.jobReference,
      });
    }
  } else {
    throw pathResult.error;
  }

  const textMappings: StoredTextMapping[] = [];

  if (!textResult.error || textResult.error.code === "42P01") {
    for (const row of textResult.data ?? []) {
      const job = extractJob(row.jobs);
      if (!job) continue;
      textMappings.push({
        mappingType: String(row.mapping_type),
        pattern: String(row.pattern),
        candidJobId: job.id,
        jobReference: job.jobReference,
      });
    }
  } else {
    throw textResult.error;
  }

  return { jobsByReference, pathMappings, textMappings };
}

function extractJob(
  jobs:
    | { id: string; job_reference: string }
    | { id: string; job_reference: string }[]
    | null
) {
  if (!jobs) return null;
  const job = Array.isArray(jobs) ? jobs[0] : jobs;
  if (!job) return null;
  return { id: job.id as string, jobReference: job.job_reference as string };
}

export function matchPrintfactoryJobWithContext(
  input: PrintfactoryReferenceSearchInput,
  context: JobMatchingContext
): JobMatchResult {
  const conflicts = extractConflictingJobReferences(input);

  if (conflicts.length > 1) {
    return {
      candidJobId: null,
      suggestedCandidJobId: null,
      jobMatchStatus: "conflict",
      jobMatchMethod: "synology_path",
      jobMatchConfidence: null,
      extractedJobReference: conflicts.join(", "),
      matchSuggestionReason: null,
      matchSuggestionDetails: { conflictReferences: conflicts },
    };
  }

  const stored = resolveStoredMapping(input, context);

  if (stored?.autoMatch) {
    return {
      candidJobId: stored.candidJobId,
      suggestedCandidJobId: null,
      jobMatchStatus: "matched_automatically",
      jobMatchMethod: "stored_mapping",
      jobMatchConfidence: 1,
      extractedJobReference: stored.jobReference,
      matchSuggestionReason: null,
      matchSuggestionDetails: { storedPattern: stored.pattern },
    };
  }

  const extracted = extractPrimaryJobReference(input);

  if (extracted) {
    const job = context.jobsByReference.get(extracted.reference.toUpperCase());

    if (job) {
      return {
        candidJobId: job.id,
        suggestedCandidJobId: null,
        jobMatchStatus: "matched_automatically",
        jobMatchMethod:
          extracted.sourceField === "source_path"
            ? "synology_path"
            : extracted.sourceField === "source_filename"
              ? "source_filename"
              : extracted.sourceField === "document_name"
                ? "document_name"
                : "job_name",
        jobMatchConfidence: 1,
        extractedJobReference: extracted.reference,
        matchSuggestionReason: null,
        matchSuggestionDetails: {
          matchedText: extracted.matchedText,
          sourceField: extracted.sourceField,
        },
      };
    }
  }

  return {
    candidJobId: null,
    suggestedCandidJobId: null,
    jobMatchStatus: "unmatched",
    jobMatchMethod: null,
    jobMatchConfidence: null,
    extractedJobReference: extracted?.reference ?? null,
    matchSuggestionReason: null,
    matchSuggestionDetails: null,
  };
}

function resolveStoredMapping(
  input: PrintfactoryReferenceSearchInput,
  context: JobMatchingContext
) {
  const path = input.sourceFilePath?.replace(/\\/g, "/") ?? "";

  for (const mapping of context.pathMappings) {
    if (path && path.startsWith(mapping.pathPrefix)) {
      return {
        autoMatch: true,
        candidJobId: mapping.candidJobId,
        jobReference: mapping.jobReference,
        pattern: mapping.pathPrefix,
      };
    }
  }

  const searchTexts = [
    { type: "path_prefix", value: path },
    { type: "job_name_pattern", value: input.jobName ?? "" },
    { type: "filename_pattern", value: input.sourceFileName ?? "" },
  ].filter((entry) => entry.value.trim());

  for (const mapping of context.textMappings) {
    const matched = searchTexts.some((entry) => {
      if (mapping.mappingType === "path_prefix" && entry.type === "path_prefix") {
        return entry.value.startsWith(mapping.pattern);
      }

      if (
        mapping.mappingType === "job_name_pattern" &&
        entry.type === "job_name_pattern"
      ) {
        return entry.value.toLowerCase().includes(mapping.pattern.toLowerCase());
      }

      if (
        mapping.mappingType === "filename_pattern" &&
        entry.type === "filename_pattern"
      ) {
        return entry.value.toLowerCase().includes(mapping.pattern.toLowerCase());
      }

      return false;
    });

    if (!matched) continue;

    const explicitRef = extractPrimaryJobReference(input);

    if (explicitRef && explicitRef.reference !== mapping.jobReference) {
      continue;
    }

    return {
      autoMatch: Boolean(explicitRef),
      candidJobId: mapping.candidJobId,
      jobReference: mapping.jobReference,
      pattern: mapping.pattern,
    };
  }

  return null;
}
