export const MANIFEST_SOURCE_TYPES = [
  "quoted",
  "additional",
  "replacement",
  "reprint",
  "manual",
  "external",
  "test",
  "internal",
] as const;

export type ManifestSourceType = (typeof MANIFEST_SOURCE_TYPES)[number];

export const MANIFEST_SOURCE_TYPE_LABELS: Record<ManifestSourceType, string> = {
  quoted: "Quoted",
  additional: "Additional",
  replacement: "Replacement",
  reprint: "Reprint",
  manual: "Manual",
  external: "External",
  test: "Test",
  internal: "Internal",
};

export const PRODUCTION_REQUIREMENT_STATUSES = [
  "required",
  "satisfied",
  "cancelled",
  "not_required",
  "combined",
  "external",
  "manual_production",
] as const;

export type ProductionRequirementStatus =
  (typeof PRODUCTION_REQUIREMENT_STATUSES)[number];

export const PRODUCTION_REQUIREMENT_STATUS_LABELS: Record<
  ProductionRequirementStatus,
  string
> = {
  required: "Required",
  satisfied: "Satisfied",
  cancelled: "Cancelled",
  not_required: "Not required",
  combined: "Combined",
  external: "External production",
  manual_production: "Manual production",
};

export const MANIFEST_BILLING_STATUSES = [
  "billable",
  "included",
  "cancelled",
  "no_charge",
  "reprint_no_charge",
  "price_required",
  "ready_to_invoice",
  "invoiced",
] as const;

export type ManifestBillingStatus = (typeof MANIFEST_BILLING_STATUSES)[number];

export const MANIFEST_BILLING_STATUS_LABELS: Record<
  ManifestBillingStatus,
  string
> = {
  billable: "Billable",
  included: "Included",
  cancelled: "Cancelled",
  no_charge: "No charge",
  reprint_no_charge: "Reprint (no charge)",
  price_required: "Price required",
  ready_to_invoice: "Ready to invoice",
  invoiced: "Invoiced",
};

export const MANIFEST_ACTIVITY_TYPES = {
  productionManifestCreated: "production_manifest_created",
  productionItemAdded: "production_item_added",
  productionItemCancelled: "production_item_cancelled",
  productionItemMarkedNoCharge: "production_item_marked_no_charge",
  productionItemReclassified: "production_item_reclassified",
} as const;

export const NON_PRINT_LINE_KEYWORDS = [
  "delivery",
  "installation",
  "install",
  "survey",
  "design time",
  "design fee",
  "project management",
  "site visit",
  "consultancy",
  "consultation",
] as const;

export function isLikelyNonPrintLine(title: string) {
  const lower = title.toLowerCase();
  return NON_PRINT_LINE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export const MANIFEST_ITEM_SELECT =
  "id, job_id, company_id, quote_id, quote_version_id, quote_item_id, item_reference, item_name, description, quantity, quoted_quantity, quote_unit_price, unit, width_mm, height_mm, area_sqm, material, machine, media_profile, copies, sides, finishing_notes, internal_note, production_status, production_requirement_status, proof_requirement, billing_status, source_type, customer_change_reason, requires_printfactory, printfactory_satisfied, printfactory_match_status, printfactory_job_guid, synology_source_path, combined_into_item_id, customer_cancelled_at, customer_cancelled_by, priority, required_at, assigned_to_profile_id, customer_safe_status, created_at, updated_at, completed_at, deleted_at";
