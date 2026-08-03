import type { SupabaseClient } from "@supabase/supabase-js";

import type { PrintfactoryJobMatchMethod } from "@/lib/printfactory/constants";
import {
  extractConflictingJobReferences,
  extractPrimaryJobReference,
  type ExtractedJobReference,
  type JobReferenceSourceField,
  type PrintfactoryReferenceSearchInput,
} from "@/lib/printfactory/job-reference-parser";

export type JobMatchSuggestion = {
  candidJobId: string;
  jobReference: string;
  projectName: string;
  companyName: string | null;
  confidenceLevel: "high" | "medium" | "low";
  reason: string;
  reasons: string[];
};

export type JobMatchResult = {
  candidJobId: string | null;
  suggestedCandidJobId: string | null;
  jobMatchStatus:
    | "unmatched"
    | "suggested"
    | "matched_automatically"
    | "conflict";
  jobMatchMethod: PrintfactoryJobMatchMethod | null;
  jobMatchConfidence: number | null;
  extractedJobReference: string | null;
  matchSuggestionReason: string | null;
  matchSuggestionDetails: Record<string, unknown> | null;
};

type PrintfactoryJobMatchInput = PrintfactoryReferenceSearchInput;

const PRESERVED_MATCH_STATUSES = new Set(["matched_manually", "ignored"]);

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "vinyl",
  "print",
  "logo",
  "mm",
  "x",
  "a",
  "an",
  "of",
  "to",
  "bank",
  "ltd",
  "limited",
]);

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function mapSourceFieldToMethod(
  sourceField: JobReferenceSourceField
): PrintfactoryJobMatchMethod {
  switch (sourceField) {
    case "source_path":
      return "synology_path";
    case "source_filename":
      return "source_filename";
    case "document_name":
      return "document_name";
    case "stored_mapping":
      return "stored_mapping";
    default:
      return "job_name";
  }
}

export function shouldPreserveExistingJobMatch(jobMatchStatus: string | null) {
  return PRESERVED_MATCH_STATUSES.has(jobMatchStatus ?? "");
}

export async function matchPrintfactoryJobToCandidJob(
  adminClient: SupabaseClient,
  input: PrintfactoryJobMatchInput
): Promise<JobMatchResult> {
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

  const storedMapping = await resolveJobByStoredMappings(adminClient, input);

  if (storedMapping?.autoMatch) {
    return {
      candidJobId: storedMapping.jobId,
      suggestedCandidJobId: null,
      jobMatchStatus: "matched_automatically",
      jobMatchMethod: "stored_mapping",
      jobMatchConfidence: 1,
      extractedJobReference: storedMapping.jobReference,
      matchSuggestionReason: null,
      matchSuggestionDetails: { storedPattern: storedMapping.pattern },
    };
  }

  const extracted = extractPrimaryJobReference(input);

  if (extracted) {
    const exactMatch = await resolveUniqueJobByReference(
      adminClient,
      extracted.reference
    );

    if (exactMatch.status === "matched") {
      return buildAutomaticMatch(extracted, exactMatch.jobId);
    }

    if (exactMatch.status === "conflict") {
      return {
        candidJobId: null,
        suggestedCandidJobId: null,
        jobMatchStatus: "conflict",
        jobMatchMethod: mapSourceFieldToMethod(extracted.sourceField),
        jobMatchConfidence: null,
        extractedJobReference: extracted.reference,
        matchSuggestionReason: null,
        matchSuggestionDetails: null,
      };
    }
  }

  if (storedMapping?.suggestion) {
    return {
      candidJobId: null,
      suggestedCandidJobId: storedMapping.jobId,
      jobMatchStatus: "suggested",
      jobMatchMethod: "stored_mapping",
      jobMatchConfidence: 0.9,
      extractedJobReference: storedMapping.jobReference,
      matchSuggestionReason: `Previously confirmed mapping: "${storedMapping.pattern}"`,
      matchSuggestionDetails: {
        storedPattern: storedMapping.pattern,
        mappingType: storedMapping.mappingType,
      },
    };
  }

  const suggestions = await buildJobMatchSuggestions(adminClient, input);

  if (suggestions.length > 0) {
    const top = suggestions[0];

    return {
      candidJobId: null,
      suggestedCandidJobId: top.candidJobId,
      jobMatchStatus: "suggested",
      jobMatchMethod: "project_title",
      jobMatchConfidence:
        top.confidenceLevel === "high"
          ? 0.85
          : top.confidenceLevel === "medium"
            ? 0.65
            : 0.45,
      extractedJobReference: extracted?.reference ?? null,
      matchSuggestionReason: top.reason,
      matchSuggestionDetails: {
        reasons: top.reasons,
        confidenceLevel: top.confidenceLevel,
        jobReference: top.jobReference,
        projectName: top.projectName,
      },
    };
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

function buildAutomaticMatch(
  extracted: ExtractedJobReference,
  candidJobId: string
): JobMatchResult {
  return {
    candidJobId,
    suggestedCandidJobId: null,
    jobMatchStatus: "matched_automatically",
    jobMatchMethod: mapSourceFieldToMethod(extracted.sourceField),
    jobMatchConfidence: 1,
    extractedJobReference: extracted.reference,
    matchSuggestionReason: null,
    matchSuggestionDetails: {
      matchedText: extracted.matchedText,
      sourceField: extracted.sourceField,
    },
  };
}

async function resolveUniqueJobByReference(
  adminClient: SupabaseClient,
  jobReference: string
): Promise<
  | { status: "matched"; jobId: string }
  | { status: "not_found" }
  | { status: "conflict" }
> {
  const { data, error } = await adminClient
    .from("jobs")
    .select("id, job_reference, status")
    .eq("job_reference", jobReference);

  if (error) {
    throw error;
  }

  const liveJobs = (data ?? []).filter((job) => job.status !== "cancelled");

  if (liveJobs.length === 0) {
    return { status: "not_found" };
  }

  if (liveJobs.length > 1) {
    return { status: "conflict" };
  }

  return { status: "matched", jobId: liveJobs[0].id as string };
}

async function resolveJobByStoredMappings(
  adminClient: SupabaseClient,
  input: PrintfactoryJobMatchInput
) {
  const path = input.sourceFilePath?.replace(/\\/g, "/") ?? "";
  const searchTexts = [
    { type: "path_prefix", value: path },
    { type: "job_name_pattern", value: input.jobName ?? "" },
    { type: "filename_pattern", value: input.sourceFileName ?? "" },
  ].filter((entry) => entry.value.trim());

  const { data: pathMappings, error: pathError } = await adminClient
    .from("printfactory_path_prefix_mappings")
    .select("path_prefix, candid_job_id, jobs!inner(id, job_reference)")
    .order("path_prefix", { ascending: false });

  if (pathError && pathError.code !== "42P01") {
    throw pathError;
  }

  for (const row of pathMappings ?? []) {
    const prefix = String(row.path_prefix);

    if (path && path.startsWith(prefix)) {
      const job = extractJobFromJoin(row.jobs);

      if (job) {
        return {
          autoMatch: true,
          suggestion: false,
          jobId: job.id,
          jobReference: job.job_reference,
          pattern: prefix,
          mappingType: "path_prefix",
        };
      }
    }
  }

  const { data: textMappings, error: textError } = await adminClient
    .from("printfactory_stored_text_mappings")
    .select("mapping_type, pattern, candid_job_id, jobs!inner(id, job_reference)")
    .order("pattern", { ascending: false });

  if (textError && textError.code !== "42P01") {
    throw textError;
  }

  for (const row of textMappings ?? []) {
    const pattern = String(row.pattern);
    const mappingType = String(row.mapping_type);

    const matched = searchTexts.some((entry) => {
      if (mappingType === "path_prefix" && entry.type === "path_prefix") {
        return entry.value.startsWith(pattern);
      }

      if (
        mappingType === "job_name_pattern" &&
        entry.type === "job_name_pattern"
      ) {
        return entry.value.toLowerCase().includes(pattern.toLowerCase());
      }

      if (
        mappingType === "filename_pattern" &&
        entry.type === "filename_pattern"
      ) {
        return entry.value.toLowerCase().includes(pattern.toLowerCase());
      }

      return false;
    });

    if (!matched) {
      continue;
    }

    const job = extractJobFromJoin(row.jobs);

    if (!job) {
      continue;
    }

    const explicitRef = extractPrimaryJobReference(input);

    if (
      explicitRef &&
      explicitRef.reference !== job.job_reference
    ) {
      continue;
    }

    return {
      autoMatch: Boolean(explicitRef),
      suggestion: !explicitRef,
      jobId: job.id,
      jobReference: job.job_reference,
      pattern,
      mappingType,
    };
  }

  return null;
}

function extractJobFromJoin(
  jobs:
    | { id: string; job_reference: string }
    | { id: string; job_reference: string }[]
    | null
) {
  if (!jobs) {
    return null;
  }

  return Array.isArray(jobs) ? jobs[0] : jobs;
}

async function buildJobMatchSuggestions(
  adminClient: SupabaseClient,
  input: PrintfactoryJobMatchInput
): Promise<JobMatchSuggestion[]> {
  const searchBlob = [
    input.jobName,
    input.sourceFileName,
    input.documentName,
  ]
    .filter(Boolean)
    .join(" ");

  if (!searchBlob.trim()) {
    return [];
  }

  const searchTokens = new Set(tokenize(searchBlob));

  if (searchTokens.size === 0) {
    return [];
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 120);

  const { data: jobs, error } = await adminClient
    .from("jobs")
    .select("id, job_reference, project_name, status, companies(company_name)")
    .neq("status", "cancelled")
    .gte("updated_at", cutoff.toISOString())
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    throw error;
  }

  const suggestions: JobMatchSuggestion[] = [];

  for (const job of jobs ?? []) {
    const projectTokens = tokenize(String(job.project_name ?? ""));
    const companyRaw = job.companies as unknown;
    const companyData = Array.isArray(companyRaw) ? companyRaw[0] : companyRaw;
    const companyName = (companyData as { company_name?: string } | null)
      ?.company_name;
    const companyTokens = tokenize(companyName ?? "");
    const reasons: string[] = [];

    let overlap = 0;

    for (const token of searchTokens) {
      if (projectTokens.includes(token)) {
        overlap += 1;
        reasons.push(`Shared project term "${token}"`);
      } else if (companyTokens.includes(token)) {
        overlap += 1;
        reasons.push(`Shared company term "${token}"`);
      }
    }

    if (overlap === 0) {
      continue;
    }

    const score =
      overlap / Math.max(searchTokens.size, projectTokens.length || 1);

    let confidenceLevel: JobMatchSuggestion["confidenceLevel"] = "low";

    if (score >= 0.5 && overlap >= 2) {
      confidenceLevel = "high";
    } else if (score >= 0.35 || overlap >= 2) {
      confidenceLevel = "medium";
    }

    if (companyName && searchBlob.toLowerCase().includes(companyName.toLowerCase())) {
      reasons.push(`PrintFactory name contains company "${companyName}"`);
      if (confidenceLevel === "low") {
        confidenceLevel = "medium";
      }
    }

    suggestions.push({
      candidJobId: job.id as string,
      jobReference: job.job_reference as string,
      projectName: job.project_name as string,
      companyName: companyName ?? null,
      confidenceLevel,
      reason: reasons[0] ?? "Title similarity",
      reasons: [...new Set(reasons)],
    });
  }

  return suggestions
    .sort((left, right) => {
      const rank = { high: 3, medium: 2, low: 1 };
      return rank[right.confidenceLevel] - rank[left.confidenceLevel];
    })
    .slice(0, 5);
}

export async function confirmSuggestedJobMatch(
  adminClient: SupabaseClient,
  printfactoryJobId: string,
  candidJobId: string,
  actorProfileId: string
) {
  return manuallyMatchPrintfactoryJob(
    adminClient,
    printfactoryJobId,
    candidJobId,
    actorProfileId
  );
}

export async function manuallyMatchPrintfactoryJob(
  adminClient: SupabaseClient,
  printfactoryJobId: string,
  candidJobId: string,
  actorProfileId: string
) {
  const { data: job, error: jobError } = await adminClient
    .from("jobs")
    .select("id, job_reference, status")
    .eq("id", candidJobId)
    .maybeSingle();

  if (jobError) {
    throw jobError;
  }

  if (!job || job.status === "cancelled") {
    throw new Error("Candid job not found or cancelled.");
  }

  const { data: pfJob, error: pfError } = await adminClient
    .from("printfactory_jobs")
    .select("source_file_path, job_name, source_file_name")
    .eq("id", printfactoryJobId)
    .maybeSingle();

  if (pfError) {
    throw pfError;
  }

  const now = new Date().toISOString();

  const { data, error } = await adminClient
    .from("printfactory_jobs")
    .update({
      candid_job_id: candidJobId,
      suggested_candid_job_id: null,
      job_match_status: "matched_manually",
      job_match_method: "manual",
      job_match_confidence: 1,
      extracted_job_reference: job.job_reference,
      match_suggestion_reason: null,
      match_suggestion_details: null,
      ignored_at: null,
      ignored_by_profile_id: null,
      ignore_reason: null,
      updated_at: now,
    })
    .eq("id", printfactoryJobId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  await storeMappingHintsFromManualMatch(
    adminClient,
    pfJob as {
      source_file_path: string | null;
      job_name: string | null;
      source_file_name: string | null;
    },
    candidJobId,
    job.job_reference as string,
    actorProfileId
  );

  return data;
}

async function storeMappingHintsFromManualMatch(
  adminClient: SupabaseClient,
  pfJob: {
    source_file_path: string | null;
    job_name: string | null;
    source_file_name: string | null;
  },
  candidJobId: string,
  jobReference: string,
  actorProfileId: string
) {
  const pathPrefix = derivePathPrefixFromSourcePath(pfJob.source_file_path);

  if (pathPrefix && pathPrefix !== "/") {
    await adminClient.from("printfactory_path_prefix_mappings").upsert(
      {
        path_prefix: pathPrefix,
        candid_job_id: candidJobId,
        created_by_profile_id: actorProfileId,
      },
      { onConflict: "path_prefix", ignoreDuplicates: false }
    );
  }

  const jobName = pfJob.job_name?.trim();

  if (jobName && jobName.length >= 8) {
    await upsertTextMapping(
      adminClient,
      "job_name_pattern",
      jobName.slice(0, Math.min(jobName.length, 80)),
      candidJobId,
      actorProfileId
    );
  }

  const filename = pfJob.source_file_name?.trim();

  if (filename && filename.length >= 6) {
    await upsertTextMapping(
      adminClient,
      "filename_pattern",
      filename.slice(0, Math.min(filename.length, 80)),
      candidJobId,
      actorProfileId
    );
  }

  if (jobReference && jobName?.toUpperCase().includes(jobReference)) {
    await upsertTextMapping(
      adminClient,
      "job_name_pattern",
      jobReference,
      candidJobId,
      actorProfileId
    );
  }
}

async function upsertTextMapping(
  adminClient: SupabaseClient,
  mappingType: string,
  pattern: string,
  candidJobId: string,
  actorProfileId: string
) {
  const { error } = await adminClient
    .from("printfactory_stored_text_mappings")
    .upsert(
      {
        mapping_type: mappingType,
        pattern,
        candid_job_id: candidJobId,
        created_by_profile_id: actorProfileId,
      },
      { onConflict: "mapping_type,pattern", ignoreDuplicates: true }
    );

  if (error && error.code !== "42P01") {
    throw error;
  }
}

function derivePathPrefixFromSourcePath(sourcePath: string | null) {
  if (!sourcePath?.trim()) {
    return "/";
  }

  const normalized = sourcePath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");

  if (lastSlash <= 0) {
    return normalized;
  }

  return normalized.slice(0, lastSlash + 1);
}

export async function clearAutomaticJobMatch(
  adminClient: SupabaseClient,
  printfactoryJobId: string
) {
  const { data: existing, error: loadError } = await adminClient
    .from("printfactory_jobs")
    .select("job_match_status")
    .eq("id", printfactoryJobId)
    .maybeSingle();

  if (loadError) {
    throw loadError;
  }

  if (existing?.job_match_status === "matched_manually") {
    throw new Error("Cannot clear a manually confirmed job match.");
  }

  const now = new Date().toISOString();

  const { data, error } = await adminClient
    .from("printfactory_jobs")
    .update({
      candid_job_id: null,
      suggested_candid_job_id: null,
      job_match_status: "unmatched",
      job_match_method: null,
      job_match_confidence: null,
      match_suggestion_reason: null,
      match_suggestion_details: null,
      updated_at: now,
    })
    .eq("id", printfactoryJobId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function ignorePrintfactoryJob(
  adminClient: SupabaseClient,
  printfactoryJobId: string,
  reason: string,
  actorProfileId: string
) {
  const now = new Date().toISOString();

  const { data, error } = await adminClient
    .from("printfactory_jobs")
    .update({
      job_match_status: "ignored",
      ignored_at: now,
      ignored_by_profile_id: actorProfileId,
      ignore_reason: reason.trim(),
      updated_at: now,
    })
    .eq("id", printfactoryJobId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function ignorePrintfactoryJobAsHistorical(
  adminClient: SupabaseClient,
  printfactoryJobId: string,
  actorProfileId: string,
  cutoffDate?: string | null
) {
  const reason = cutoffDate
    ? `Ignored as historical (before ${cutoffDate})`
    : "Ignored as historical import";

  return ignorePrintfactoryJob(adminClient, printfactoryJobId, reason, actorProfileId);
}
