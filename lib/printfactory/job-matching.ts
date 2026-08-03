import type { SupabaseClient } from "@supabase/supabase-js";

import type { PrintfactoryJobMatchMethod } from "@/lib/printfactory/constants";
import {
  extractJobReferencesFromText,
  extractPrimaryJobReferenceFromPath,
  pathContainsConflictingJobReferences,
} from "@/lib/printfactory/job-reference-parser";

export type JobMatchResult = {
  candidJobId: string | null;
  jobMatchStatus:
    | "unmatched"
    | "suggested"
    | "matched_automatically"
    | "conflict";
  jobMatchMethod: PrintfactoryJobMatchMethod | null;
  jobMatchConfidence: number | null;
  extractedJobReference: string | null;
};

type PrintfactoryJobMatchInput = {
  source_file_path: string | null;
  job_name: string | null;
  source_file_name: string | null;
};

const PRESERVED_MATCH_STATUSES = new Set([
  "matched_manually",
  "ignored",
]);

export function shouldPreserveExistingJobMatch(jobMatchStatus: string | null) {
  return PRESERVED_MATCH_STATUSES.has(jobMatchStatus ?? "");
}

export async function matchPrintfactoryJobToCandidJob(
  adminClient: SupabaseClient,
  input: PrintfactoryJobMatchInput
): Promise<JobMatchResult> {
  const path = input.source_file_path?.trim() ?? "";

  if (path && pathContainsConflictingJobReferences(path)) {
    return {
      candidJobId: null,
      jobMatchStatus: "conflict",
      jobMatchMethod: "synology_path",
      jobMatchConfidence: null,
      extractedJobReference: extractJobReferencesFromText(path).join(", "),
    };
  }

  const pathReference = path ? extractPrimaryJobReferenceFromPath(path) : null;

  if (pathReference) {
    const exactMatch = await resolveUniqueJobByReference(
      adminClient,
      pathReference
    );

    if (exactMatch.status === "matched") {
      return {
        candidJobId: exactMatch.jobId,
        jobMatchStatus: "matched_automatically",
        jobMatchMethod: "synology_path",
        jobMatchConfidence: 1,
        extractedJobReference: pathReference,
      };
    }

    if (exactMatch.status === "conflict") {
      return {
        candidJobId: null,
        jobMatchStatus: "conflict",
        jobMatchMethod: "synology_path",
        jobMatchConfidence: null,
        extractedJobReference: pathReference,
      };
    }
  }

  const suggestionSources = [
    input.job_name,
    input.source_file_name,
  ].filter(Boolean) as string[];

  for (const source of suggestionSources) {
    const references = extractJobReferencesFromText(source);

    if (references.length !== 1) {
      continue;
    }

    const reference = references[0];
    const exactMatch = await resolveUniqueJobByReference(
      adminClient,
      reference
    );

    if (exactMatch.status === "matched") {
      return {
        candidJobId: exactMatch.jobId,
        jobMatchStatus: "suggested",
        jobMatchMethod: source === input.job_name ? "job_name" : "synology_path",
        jobMatchConfidence: 0.85,
        extractedJobReference: reference,
      };
    }
  }

  if (path) {
    const prefixMatch = await resolveJobByStoredPathPrefix(adminClient, path);

    if (prefixMatch) {
      return {
        candidJobId: prefixMatch.jobId,
        jobMatchStatus: "suggested",
        jobMatchMethod: "stored_mapping",
        jobMatchConfidence: 0.75,
        extractedJobReference: prefixMatch.jobReference,
      };
    }
  }

  return {
    candidJobId: null,
    jobMatchStatus: "unmatched",
    jobMatchMethod: null,
    jobMatchConfidence: null,
    extractedJobReference: pathReference,
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

async function resolveJobByStoredPathPrefix(
  adminClient: SupabaseClient,
  sourcePath: string
) {
  const normalizedPath = sourcePath.replace(/\\/g, "/");

  const { data, error } = await adminClient
    .from("printfactory_path_prefix_mappings")
    .select("path_prefix, candid_job_id, jobs!inner(id, job_reference)")
    .order("path_prefix", { ascending: false });

  if (error) {
    if (error.code === "42P01") {
      return null;
    }

    throw error;
  }

  for (const row of data ?? []) {
    const prefix = String(row.path_prefix);

    if (normalizedPath.startsWith(prefix)) {
      const jobData = row.jobs as
        | { id: string; job_reference: string }
        | { id: string; job_reference: string }[]
        | null;
      const job = Array.isArray(jobData) ? jobData[0] : jobData;

      if (!job) {
        continue;
      }

      return {
        jobId: job.id,
        jobReference: job.job_reference,
      };
    }
  }

  return null;
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

  const now = new Date().toISOString();

  const { data, error } = await adminClient
    .from("printfactory_jobs")
    .update({
      candid_job_id: candidJobId,
      job_match_status: "matched_manually",
      job_match_method: "manual",
      job_match_confidence: 1,
      extracted_job_reference: job.job_reference,
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

  const pathPrefix = derivePathPrefixFromSourcePath(
    (data as { source_file_path: string | null }).source_file_path
  );

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

  return data;
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
