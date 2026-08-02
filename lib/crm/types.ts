export const OPPORTUNITY_STAGES = [
  "new_enquiry",
  "qualifying",
  "quote_in_progress",
  "quote_sent",
  "follow_up",
  "won",
  "lost",
] as const;

export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const OPPORTUNITY_SOURCES = [
  "customer_portal",
  "admin",
  "phone",
  "email",
  "referral",
  "walk_in",
  "other",
] as const;

export type OpportunitySource = (typeof OPPORTUNITY_SOURCES)[number];

export const TASK_STATUSES = [
  "open",
  "in_progress",
  "completed",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type OpportunityRecord = {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  estimated_value: number | null;
  currency: string;
  stage: OpportunityStage;
  owner_profile_id: string;
  expected_close_date: string | null;
  next_follow_up_at: string | null;
  source: OpportunitySource;
  lost_reason: string | null;
  won_at: string | null;
  lost_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type OpportunityMemberRecord = {
  opportunity_id: string;
  profile_id: string;
  created_at: string;
};

export type TaskRecord = {
  id: string;
  title: string;
  description: string | null;
  assigned_to: string;
  created_by: string;
  due_at: string | null;
  completed_at: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  opportunity_id: string | null;
  quote_id: string | null;
  company_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskAssigneeRecord = {
  task_id: string;
  profile_id: string;
  assigned_at: string;
  assigned_by: string | null;
};

export type OpportunityNoteRecord = {
  id: string;
  opportunity_id: string;
  body: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type OpportunityActivityRecord = {
  id: string;
  opportunity_id: string;
  activity_type: string;
  description: string;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
};

export const CRM_MIGRATION_DOC_PATH =
  "docs/proposed-crm-foundation-migration.sql";
