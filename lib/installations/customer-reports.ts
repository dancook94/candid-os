import type { SupabaseClient } from "@supabase/supabase-js";

import { INSTALLATION_FILES_BUCKET } from "@/lib/installations/constants";
import { JobError } from "@/lib/jobs/errors";

export type CustomerInstallationReport = {
  id: string;
  reportReference: string;
  versionNumber: number;
  visitId: string;
  visitNumber: number;
  visitTitle: string;
  visitCompletedAt: string | null;
  publishedAt: string;
};

const PROJECT_PUBLISHED_REPORTS_SELECT = `
  id,
  company_id,
  installation_visits(
    id,
    visit_number,
    title,
    completed_at,
    scheduled_start_at,
    installation_visit_published_reports(
      published_at,
      installation_completion_report_id,
      installation_completion_reports(
        id,
        report_reference,
        version_number
      )
    )
  )
`;

function visitDate(row: {
  completed_at?: string | null;
  scheduled_start_at?: string | null;
}) {
  return row.completed_at ?? row.scheduled_start_at ?? null;
}

export async function loadCustomerPublishedInstallationReports(
  adminClient: SupabaseClient,
  input: { jobId: string; companyId: string }
): Promise<CustomerInstallationReport[]> {
  const { data, error } = await adminClient
    .from("installation_projects")
    .select(PROJECT_PUBLISHED_REPORTS_SELECT)
    .eq("job_id", input.jobId)
    .eq("company_id", input.companyId)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01") {
      return [];
    }
    throw new JobError(error.message, 500);
  }

  if (!data) {
    return [];
  }

  const visits = Array.isArray(data.installation_visits) ? data.installation_visits : [];
  const reports: CustomerInstallationReport[] = [];

  for (const visit of visits) {
    const visitRecord = visit as {
      id?: string;
      visit_number?: number;
      title?: string;
      completed_at?: string | null;
      scheduled_start_at?: string | null;
      installation_visit_published_reports?:
        | {
            published_at?: string;
            installation_completion_report_id?: string;
            installation_completion_reports?:
              | { id?: string; report_reference?: string; version_number?: number }
              | { id?: string; report_reference?: string; version_number?: number }[];
          }
        | {
            published_at?: string;
            installation_completion_report_id?: string;
            installation_completion_reports?:
              | { id?: string; report_reference?: string; version_number?: number }
              | { id?: string; report_reference?: string; version_number?: number }[];
          }[];
    };
    const publication = Array.isArray(visitRecord.installation_visit_published_reports)
      ? visitRecord.installation_visit_published_reports[0]
      : visitRecord.installation_visit_published_reports;
    if (!publication?.installation_completion_report_id || !publication.published_at) {
      continue;
    }

    const report = Array.isArray(publication.installation_completion_reports)
      ? publication.installation_completion_reports[0]
      : publication.installation_completion_reports;
    if (!report?.id) {
      continue;
    }

    reports.push({
      id: String(report.id),
      reportReference: String(report.report_reference || "Report"),
      versionNumber: Number(report.version_number) || 0,
      visitId: String(visitRecord.id),
      visitNumber: Number(visitRecord.visit_number) || 0,
      visitTitle: String(visitRecord.title || "Installation visit"),
      visitCompletedAt: visitDate(visitRecord),
      publishedAt: String(publication.published_at),
    });
  }

  reports.sort((left, right) => {
    if (left.visitNumber !== right.visitNumber) {
      return left.visitNumber - right.visitNumber;
    }
    return left.publishedAt.localeCompare(right.publishedAt);
  });

  return reports;
}

export type CustomerPublishedReportFile = {
  reportReference: string;
  storagePath: string;
  byteSize: number;
};

/**
 * Loads a report file only when it is the currently published version for the job.
 */
export async function loadCustomerPublishedInstallationReportFile(
  adminClient: SupabaseClient,
  input: { jobId: string; companyId: string; reportId: string }
): Promise<CustomerPublishedReportFile> {
  const { data, error } = await adminClient
    .from("installation_visit_published_reports")
    .select(
      `
        installation_completion_report_id,
        installation_completion_reports!inner(
          id,
          report_reference,
          storage_path,
          byte_size
        ),
        installation_visits!inner(
          installation_projects!inner(job_id, company_id)
        )
      `
    )
    .eq("installation_completion_report_id", input.reportId)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01") {
      throw new JobError("Report not found.", 404);
    }
    throw new JobError(error.message, 500);
  }

  if (!data) {
    throw new JobError("Report not found.", 404);
  }

  const visit = Array.isArray(data.installation_visits)
    ? data.installation_visits[0]
    : data.installation_visits;
  const project = visit && typeof visit === "object"
    ? Array.isArray(visit.installation_projects)
      ? visit.installation_projects[0]
      : visit.installation_projects
    : null;

  if (
    !project ||
    typeof project !== "object" ||
    project.job_id !== input.jobId ||
    project.company_id !== input.companyId
  ) {
    throw new JobError("Forbidden.", 403);
  }

  const report = Array.isArray(data.installation_completion_reports)
    ? data.installation_completion_reports[0]
    : data.installation_completion_reports;

  const storagePath =
    report && typeof report === "object" && typeof report.storage_path === "string"
      ? report.storage_path
      : "";
  if (!storagePath) {
    throw new JobError("Report file is not available.", 404);
  }

  return {
    reportReference: String(report && typeof report === "object" ? report.report_reference : "Report"),
    storagePath,
    byteSize:
      report && typeof report === "object" && typeof report.byte_size === "number"
        ? report.byte_size
        : 0,
  };
}

export async function downloadCustomerPublishedReportBytes(
  adminClient: SupabaseClient,
  file: CustomerPublishedReportFile
) {
  const { data, error } = await adminClient.storage.from(INSTALLATION_FILES_BUCKET).download(file.storagePath);
  if (error || !data) {
    throw new JobError("Report file is not available.", 404);
  }
  return new Uint8Array(await data.arrayBuffer());
}

export function buildCustomerInstallationReportUrl(jobId: string, reportId: string) {
  return `/jobs/${jobId}#installation-report-${reportId}`;
}
