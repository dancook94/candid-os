import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isProblemReportPriority,
  isProblemReportStatus,
  isSchemaMissingError,
  type ProblemReportPriority,
  type ProblemReportRecord,
  type ProblemReportStatus,
} from "@/lib/updates/types";

const PROBLEM_REPORT_SELECT = `
  id,
  reporter_id,
  company_id,
  reporter_name,
  reporter_email,
  reporter_role,
  description,
  attempted_action,
  priority,
  status,
  source_path,
  user_agent,
  admin_notes,
  resolved_at,
  resolved_by,
  created_at,
  updated_at
`;

export async function fetchOwnProblemReports(
  supabase: SupabaseClient,
  reporterId: string
) {
  const { data, error } = await supabase
    .from("problem_reports")
    .select(PROBLEM_REPORT_SELECT)
    .eq("reporter_id", reporterId)
    .order("created_at", { ascending: false });

  if (error) {
    if (isSchemaMissingError(error)) {
      return { reports: [] as ProblemReportRecord[], schemaMissing: true, error: null };
    }

    return {
      reports: [] as ProblemReportRecord[],
      schemaMissing: false,
      error: error.message,
    };
  }

  return {
    reports: (data ?? []) as ProblemReportRecord[],
    schemaMissing: false,
    error: null,
  };
}

export type ProblemReportListFilters = {
  status?: string;
  priority?: string;
  reporterType?: "staff" | "customer";
  page?: number;
  pageSize?: number;
};

export async function fetchAdminProblemReports(
  supabase: SupabaseClient,
  filters: ProblemReportListFilters
) {
  const page = Math.max(filters.page ?? 1, 1);
  const pageSize = Math.min(Math.max(filters.pageSize ?? 50, 1), 100);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("problem_reports")
    .select(PROBLEM_REPORT_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (filters.status && isProblemReportStatus(filters.status)) {
    query = query.eq("status", filters.status);
  }

  if (filters.priority && isProblemReportPriority(filters.priority)) {
    query = query.eq("priority", filters.priority);
  }

  if (filters.reporterType === "customer") {
    query = query.eq("reporter_role", "customer");
  }

  if (filters.reporterType === "staff") {
    query = query.neq("reporter_role", "customer");
  }

  const { data, error, count } = await query;

  if (error) {
    if (isSchemaMissingError(error)) {
      return {
        reports: [] as ProblemReportRecord[],
        totalCount: 0,
        schemaMissing: true,
        error: null,
      };
    }

    return {
      reports: [] as ProblemReportRecord[],
      totalCount: 0,
      schemaMissing: false,
      error: error.message,
    };
  }

  return {
    reports: (data ?? []) as ProblemReportRecord[],
    totalCount: count ?? 0,
    schemaMissing: false,
    error: null,
  };
}

export async function fetchProblemReportById(
  supabase: SupabaseClient,
  reportId: string
) {
  const { data, error } = await supabase
    .from("problem_reports")
    .select(PROBLEM_REPORT_SELECT)
    .eq("id", reportId)
    .maybeSingle();

  if (error) {
    if (isSchemaMissingError(error)) {
      return { report: null, schemaMissing: true, error: null };
    }

    return { report: null, schemaMissing: false, error: error.message };
  }

  return {
    report: (data as ProblemReportRecord | null) ?? null,
    schemaMissing: false,
    error: null,
  };
}

export function validateProblemReportSubmission(input: {
  description?: string;
  attemptedAction?: string;
  priority?: string;
  sourcePath?: string;
}) {
  const description = input.description?.trim() ?? "";
  const attemptedAction = input.attemptedAction?.trim() ?? "";
  const priority = input.priority?.trim() ?? "minor";
  const sourcePath = input.sourcePath?.trim() ?? null;

  if (!description) {
    return { ok: false as const, message: "Please describe what went wrong." };
  }

  if (description.length > 5000) {
    return {
      ok: false as const,
      message: "Description must be 5,000 characters or fewer.",
    };
  }

  if (attemptedAction.length > 2000) {
    return {
      ok: false as const,
      message: "Attempted action must be 2,000 characters or fewer.",
    };
  }

  if (!isProblemReportPriority(priority)) {
    return { ok: false as const, message: "Invalid priority." };
  }

  if (sourcePath && sourcePath.length > 500) {
    return { ok: false as const, message: "Source path is too long." };
  }

  return {
    ok: true as const,
    value: {
      description,
      attemptedAction: attemptedAction || null,
      priority: priority as ProblemReportPriority,
      sourcePath,
    },
  };
}

export async function createProblemReport(
  supabase: SupabaseClient,
  input: {
    reporterId: string;
    reporterName: string;
    reporterEmail: string;
    reporterRole: string;
    companyId: string | null;
    description: string;
    attemptedAction: string | null;
    priority: ProblemReportPriority;
    sourcePath: string | null;
    userAgent: string | null;
  }
) {
  const { data, error } = await supabase
    .from("problem_reports")
    .insert({
      reporter_id: input.reporterId,
      reporter_name: input.reporterName,
      reporter_email: input.reporterEmail,
      reporter_role: input.reporterRole,
      company_id: input.companyId,
      description: input.description,
      attempted_action: input.attemptedAction,
      priority: input.priority,
      status: "reported",
      source_path: input.sourcePath,
      user_agent: input.userAgent,
    })
    .select(PROBLEM_REPORT_SELECT)
    .single();

  if (error) {
    return { ok: false as const, message: error.message };
  }

  return { ok: true as const, report: data as ProblemReportRecord };
}

export async function updateProblemReportAdminFields(
  supabase: SupabaseClient,
  reportId: string,
  input: {
    status: ProblemReportStatus;
    adminNotes: string | null;
    resolvedBy?: string | null;
  }
) {
  const resolvedAt =
    input.status === "fixed" || input.status === "closed"
      ? new Date().toISOString()
      : null;

  const { data, error } = await supabase
    .from("problem_reports")
    .update({
      status: input.status,
      admin_notes: input.adminNotes,
      resolved_at: resolvedAt,
      resolved_by: resolvedAt ? input.resolvedBy ?? null : null,
    })
    .eq("id", reportId)
    .select(PROBLEM_REPORT_SELECT)
    .single();

  if (error) {
    return { ok: false as const, message: error.message };
  }

  return { ok: true as const, report: data as ProblemReportRecord };
}

export function validateProblemReportAdminUpdate(input: {
  status?: string;
  adminNotes?: string;
}) {
  const status = input.status?.trim() ?? "";
  const adminNotes = input.adminNotes?.trim() ?? null;

  if (!isProblemReportStatus(status)) {
    return { ok: false as const, message: "Invalid status." };
  }

  if (adminNotes && adminNotes.length > 5000) {
    return { ok: false as const, message: "Admin notes must be 5,000 characters or fewer." };
  }

  return {
    ok: true as const,
    value: {
      status: status as ProblemReportStatus,
      adminNotes,
    },
  };
}

export function summarizeProblemReportDescription(description: string, max = 80) {
  const normalized = description.trim().replace(/\s+/g, " ");

  if (normalized.length <= max) {
    return normalized;
  }

  return `${normalized.slice(0, max - 1)}…`;
}
