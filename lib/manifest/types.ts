import type {
  ManifestBillingStatus,
  ManifestSourceType,
  ProductionRequirementStatus,
} from "@/lib/manifest/constants";
import type { ProductionStatus } from "@/lib/production/constants";

export type ManifestItemRecord = {
  id: string;
  job_id: string;
  company_id: string;
  quote_id: string | null;
  quote_version_id: string | null;
  quote_item_id: string | null;
  item_reference: string | null;
  item_name: string;
  description: string | null;
  quantity: number | null;
  quoted_quantity: number | null;
  quote_unit_price: number | null;
  unit: string | null;
  width_mm: number | null;
  height_mm: number | null;
  area_sqm: number | null;
  material: string | null;
  machine: string | null;
  media_profile: string | null;
  copies: number | null;
  sides: string | null;
  finishing_notes: string | null;
  internal_note: string | null;
  production_status: ProductionStatus;
  production_requirement_status: ProductionRequirementStatus;
  proof_requirement?: string | null;
  billing_status: ManifestBillingStatus;
  source_type: ManifestSourceType;
  customer_change_reason: string | null;
  requires_printfactory: boolean;
  printfactory_satisfied: boolean;
  printfactory_match_status: string;
  printfactory_job_guid: string | null;
  synology_source_path: string | null;
  combined_into_item_id: string | null;
  customer_cancelled_at: string | null;
  customer_cancelled_by: string | null;
  priority: string;
  required_at: string | null;
  assigned_to_profile_id: string | null;
  customer_safe_status: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  deleted_at: string | null;
};

export type ManifestReconcileResult = {
  created: number;
  skipped: number;
  totalQuoteItems: number;
  schemaMissing: boolean;
  error: string | null;
};

export type ManifestItemFormInput = {
  itemName: string;
  description?: string | null;
  quantity?: number | null;
  unit?: string | null;
  material?: string | null;
  machine?: string | null;
  widthMm?: number | null;
  heightMm?: number | null;
  productionRequirementStatus?: ProductionRequirementStatus;
  proofRequirement?: string | null;
  billingStatus?: ManifestBillingStatus;
  sourceType?: ManifestSourceType;
  requiresPrintfactory?: boolean;
  internalNote?: string | null;
  productionStatus?: ProductionStatus;
};

export type CancelManifestItemInput = {
  reason: string;
  effectiveAt?: string;
};
