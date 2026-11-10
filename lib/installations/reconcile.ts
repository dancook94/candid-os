import type { SupabaseClient } from "@supabase/supabase-js";

import { jobRequiresInstallationProject } from "@/lib/installations/detection";
import { InstallationError, isMissingInstallationSchemaError } from "@/lib/installations/errors";
import { loadQuoteVersionInstallationSignals } from "@/lib/installations/load-quote-installation-signals";

type JobRow = {
  id: string;
  company_id: string;
  quote_id: string | null;
  quote_version_id: string | null;
  job_reference: string;
  project_name: string | null;
};

export type InstallationReconcileResult = {
  jobId: string;
  projectId: string | null;
  createdProject: boolean;
  createdInitialVisit: boolean;
  skippedReason: string | null;
  signalCount: number;
};

/**
 * Idempotent installation project reconciliation for an accepted job.
 * Does not schedule visits from job.required_date.
 * Not wired to quote acceptance in Phase 1.
 */
export async function reconcileInstallationProjectForJob(
  adminClient: SupabaseClient,
  jobId: string,
  options?: { actorProfileId?: string | null }
): Promise<InstallationReconcileResult> {
  const job = await loadJob(adminClient, jobId);

  if (!job.quote_version_id) {
    return emptyResult(jobId, "Job has no quote version.");
  }

  const signals = await loadQuoteVersionInstallationSignals(
    adminClient,
    job.quote_version_id
  );

  if (!jobRequiresInstallationProject(signals)) {
    const existing = await loadProjectByJobId(adminClient, job.id);
    return {
      jobId,
      projectId: existing?.id ?? null,
      createdProject: false,
      createdInitialVisit: false,
      skippedReason: "No installation work detected on accepted quote version.",
      signalCount: 0,
    };
  }

  let project = await loadProjectByJobId(adminClient, job.id);
  let createdProject = false;
  let createdInitialVisit = false;

  if (!project) {
    project = await insertProject(adminClient, {
      job,
      actorProfileId: options?.actorProfileId ?? null,
    });
    createdProject = true;
  }

  const visitCount = await countVisits(adminClient, project.id);

  if (visitCount === 0) {
    await insertInitialVisit(adminClient, {
      projectId: project.id,
      title: "Initial site visit",
      actorProfileId: options?.actorProfileId ?? null,
    });
    createdInitialVisit = true;
  }

  return {
    jobId,
    projectId: project.id,
    createdProject,
    createdInitialVisit,
    skippedReason: null,
    signalCount: signals.length,
  };
}

function emptyResult(jobId: string, reason: string): InstallationReconcileResult {
  return {
    jobId,
    projectId: null,
    createdProject: false,
    createdInitialVisit: false,
    skippedReason: reason,
    signalCount: 0,
  };
}

async function loadJob(adminClient: SupabaseClient, jobId: string): Promise<JobRow> {
  const { data, error } = await adminClient
    .from("jobs")
    .select(
      "id, company_id, quote_id, quote_version_id, job_reference, project_name"
    )
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    if (isMissingInstallationSchemaError(error.message)) {
      throw new InstallationError(error.message, 503);
    }

    throw new InstallationError(error.message, 500);
  }

  if (!data) {
    throw new InstallationError("Job not found.", 404);
  }

  return data as JobRow;
}

async function loadProjectByJobId(adminClient: SupabaseClient, jobId: string) {
  const { data, error } = await adminClient
    .from("installation_projects")
    .select("id, job_id")
    .eq("job_id", jobId)
    .maybeSingle();

  if (error) {
    if (isMissingInstallationSchemaError(error.message)) {
      throw new InstallationError(
        "Installation schema is not available. Apply migration 20270110163000 on Test Supabase.",
        503
      );
    }

    throw new InstallationError(error.message, 500);
  }

  return data as { id: string; job_id: string } | null;
}

async function countVisits(adminClient: SupabaseClient, projectId: string) {
  const { count, error } = await adminClient
    .from("installation_visits")
    .select("id", { count: "exact", head: true })
    .eq("installation_project_id", projectId);

  if (error) {
    throw new InstallationError(error.message, 500);
  }

  return count ?? 0;
}

async function insertProject(
  adminClient: SupabaseClient,
  input: { job: JobRow; actorProfileId: string | null }
) {
  const title =
    input.job.project_name?.trim() ||
    `Installation — ${input.job.job_reference}`;

  const { data, error } = await adminClient
    .from("installation_projects")
    .insert({
      company_id: input.job.company_id,
      job_id: input.job.id,
      quote_id: input.job.quote_id,
      quote_version_id: input.job.quote_version_id,
      title,
      description: null,
      source: "quote_reconcile",
      status: "active",
      created_by: input.actorProfileId,
    })
    .select("id, job_id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const existing = await loadProjectByJobId(adminClient, input.job.id);
      if (existing) {
        return existing;
      }
    }

    throw new InstallationError(error.message, 500);
  }

  return data as { id: string; job_id: string };
}

async function insertInitialVisit(
  adminClient: SupabaseClient,
  input: {
    projectId: string;
    title: string;
    actorProfileId: string | null;
  }
) {
  const { error } = await adminClient.from("installation_visits").insert({
    installation_project_id: input.projectId,
    visit_number: 1,
    title: input.title,
    purpose: "quote_reconcile",
    status: "unscheduled",
    created_by: input.actorProfileId,
  });

  if (error) {
    throw new InstallationError(error.message, 500);
  }
}
