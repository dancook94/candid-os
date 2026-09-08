export const PRODUCT_UPDATE_CATEGORIES = ["new", "improvement", "fix"] as const;
export const PRODUCT_UPDATE_AUDIENCES = ["everyone", "staff", "customers"] as const;

export const PROBLEM_REPORT_PRIORITIES = ["minor", "blocking"] as const;
export const PROBLEM_REPORT_STATUSES = [
  "reported",
  "reviewing",
  "planned",
  "in_progress",
  "fixed",
  "closed",
] as const;

export type ProductUpdateCategory = (typeof PRODUCT_UPDATE_CATEGORIES)[number];
export type ProductUpdateAudience = (typeof PRODUCT_UPDATE_AUDIENCES)[number];
export type ProblemReportPriority = (typeof PROBLEM_REPORT_PRIORITIES)[number];
export type ProblemReportStatus = (typeof PROBLEM_REPORT_STATUSES)[number];

export type ProductUpdateRecord = {
  id: string;
  title: string;
  body: string;
  category: ProductUpdateCategory;
  audience: ProductUpdateAudience;
  is_published: boolean;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ProblemReportRecord = {
  id: string;
  reporter_id: string;
  company_id: string | null;
  reporter_name: string;
  reporter_email: string;
  reporter_role: string;
  description: string;
  attempted_action: string | null;
  priority: ProblemReportPriority;
  status: ProblemReportStatus;
  source_path: string | null;
  user_agent: string | null;
  admin_notes: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ProblemReportAttachmentRecord = {
  id: string;
  report_id: string;
  storage_path: string;
  file_name: string;
  file_type: string;
  file_size: number;
  uploaded_by: string;
  created_at: string;
};

export function isProductUpdateCategory(
  value: string
): value is ProductUpdateCategory {
  return (PRODUCT_UPDATE_CATEGORIES as readonly string[]).includes(value);
}

export function isProductUpdateAudience(
  value: string
): value is ProductUpdateAudience {
  return (PRODUCT_UPDATE_AUDIENCES as readonly string[]).includes(value);
}

export function isProblemReportPriority(
  value: string
): value is ProblemReportPriority {
  return (PROBLEM_REPORT_PRIORITIES as readonly string[]).includes(value);
}

export function isProblemReportStatus(
  value: string
): value is ProblemReportStatus {
  return (PROBLEM_REPORT_STATUSES as readonly string[]).includes(value);
}

export function formatProductUpdateCategoryLabel(
  category: ProductUpdateCategory
) {
  switch (category) {
    case "new":
      return "New";
    case "improvement":
      return "Improvement";
    case "fix":
      return "Fix";
  }
}

export function formatProductUpdateAudienceLabel(
  audience: ProductUpdateAudience
) {
  switch (audience) {
    case "everyone":
      return "Everyone";
    case "staff":
      return "Staff";
    case "customers":
      return "Customers";
  }
}

export function formatProblemReportPriorityLabel(
  priority: ProblemReportPriority
) {
  return priority === "blocking" ? "Stopping me working" : "Minor";
}

export function formatProblemReportStatusLabel(status: ProblemReportStatus) {
  switch (status) {
    case "reported":
      return "Reported";
    case "reviewing":
      return "Reviewing";
    case "planned":
      return "Planned";
    case "in_progress":
      return "In progress";
    case "fixed":
      return "Fixed";
    case "closed":
      return "Closed";
  }
}

export function audienceMatchesUserRole(
  audience: ProductUpdateAudience,
  userRole: string
): boolean {
  if (audience === "everyone") {
    return true;
  }

  if (audience === "staff") {
    return userRole !== "customer";
  }

  return userRole === "customer";
}

export function isSchemaMissingError(error: { code?: string } | null | undefined) {
  return error?.code === "42P01" || error?.code === "PGRST205";
}
