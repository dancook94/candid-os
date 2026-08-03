export const PRODUCTION_STATUSES = [
  "artwork",
  "ready_for_production",
  "printing",
  "cutting",
  "laminating",
  "finishing",
  "quality_check",
  "packing",
  "ready_for_dispatch",
  "completed",
  "on_hold",
] as const;

export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

export const PRODUCTION_BOARD_COLUMNS: ProductionStatus[] = [
  "artwork",
  "ready_for_production",
  "printing",
  "cutting",
  "laminating",
  "finishing",
  "quality_check",
  "packing",
  "ready_for_dispatch",
  "completed",
  "on_hold",
];

export const PRODUCTION_STATUS_LABELS: Record<ProductionStatus, string> = {
  artwork: "Artwork",
  ready_for_production: "Ready for production",
  printing: "Printing",
  cutting: "Cutting",
  laminating: "Laminating",
  finishing: "Finishing",
  quality_check: "Quality check",
  packing: "Packing",
  ready_for_dispatch: "Ready for dispatch",
  completed: "Completed",
  on_hold: "On hold",
};

export const PRODUCTION_PRIORITIES = [
  "low",
  "normal",
  "high",
  "urgent",
] as const;

export type ProductionPriority = (typeof PRODUCTION_PRIORITIES)[number];

export const PRODUCTION_PRIORITY_LABELS: Record<ProductionPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const CUSTOMER_SAFE_STATUSES = [
  "artwork_being_prepared",
  "in_production",
  "preparing_for_dispatch",
  "completed",
  "on_hold",
] as const;

export type CustomerSafeStatus = (typeof CUSTOMER_SAFE_STATUSES)[number];

export const CUSTOMER_SAFE_STATUS_LABELS: Record<CustomerSafeStatus, string> = {
  artwork_being_prepared: "Artwork being prepared",
  in_production: "In production",
  preparing_for_dispatch: "Preparing for dispatch",
  completed: "Completed",
  on_hold: "On hold",
};

export const PRINTFACTORY_MATCH_STATUSES = [
  "unmatched",
  "suggested",
  "matched_automatically",
  "matched_manually",
  "ignored",
] as const;

export type PrintfactoryMatchStatus = (typeof PRINTFACTORY_MATCH_STATUSES)[number];

export const PRINTFACTORY_MATCH_STATUS_LABELS: Record<
  PrintfactoryMatchStatus,
  string
> = {
  unmatched: "Unmatched",
  suggested: "Suggested",
  matched_automatically: "Matched automatically",
  matched_manually: "Matched manually",
  ignored: "Ignored",
};

export const PRODUCTION_SIDES = ["single", "double"] as const;

export type ProductionSides = (typeof PRODUCTION_SIDES)[number];

export const PRODUCTION_ACTIVITY_TYPES = {
  productionItemCreated: "production_item_created",
  productionItemUpdated: "production_item_updated",
  productionItemStageChanged: "production_item_stage_changed",
  productionItemAssigned: "production_item_assigned",
  productionItemCompleted: "production_item_completed",
  productionItemPutOnHold: "production_item_put_on_hold",
} as const;

export const PRODUCTION_ITEM_SELECT =
  "id, job_id, company_id, item_reference, item_name, description, quantity, production_status, priority, required_at, assigned_to_profile_id, machine, material, media_profile, width_mm, height_mm, copies, sides, finishing_notes, customer_safe_status, synology_source_path, printfactory_match_status, printfactory_job_guid, created_at, updated_at, completed_at, deleted_at";
