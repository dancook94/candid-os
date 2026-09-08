import type {
  CustomerSafeStatus,
  PrintfactoryMatchStatus,
  ProductionPriority,
  ProductionSides,
  ProductionStatus,
} from "@/lib/production/constants";

export type ProductionItemRecord = {
  id: string;
  job_id: string;
  company_id: string;
  item_reference: string | null;
  item_name: string;
  description: string | null;
  quantity: number | null;
  production_status: ProductionStatus;
  priority: ProductionPriority;
  required_at: string | null;
  assigned_to_profile_id: string | null;
  machine: string | null;
  material: string | null;
  media_profile: string | null;
  width_mm: number | null;
  height_mm: number | null;
  copies: number | null;
  sides: ProductionSides | null;
  finishing_notes: string | null;
  customer_safe_status: CustomerSafeStatus;
  synology_source_path: string | null;
  printfactory_match_status: PrintfactoryMatchStatus;
  printfactory_job_guid: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  deleted_at: string | null;
};

export type ProductionBoardCard = {
  id: string;
  job_id: string;
  job_reference: string;
  project_name: string;
  company_id: string;
  company_name: string;
  item_reference: string | null;
  item_name: string;
  description: string | null;
  quantity: number | null;
  production_status: ProductionStatus;
  priority: ProductionPriority;
  required_at: string | null;
  assigned_to_profile_id: string | null;
  assigned_to_name: string | null;
  machine: string | null;
  material: string | null;
  artwork_status_label: string;
  job_artwork_source: string;
  updated_at: string;
  is_overdue: boolean;
  is_due_today: boolean;
  is_due_tomorrow: boolean;
  is_urgent: boolean;
  is_on_hold: boolean;
};

export type ProductionBoardData = {
  columns: Record<ProductionStatus, ProductionBoardCard[]>;
  counts: Record<ProductionStatus, number>;
  totalCount: number;
};

export type ProductionItemFormInput = {
  itemName: string;
  description?: string | null;
  quantity?: number | null;
  requiredAt?: string | null;
  priority?: ProductionPriority;
  machine?: string | null;
  material?: string | null;
  mediaProfile?: string | null;
  widthMm?: number | null;
  heightMm?: number | null;
  copies?: number | null;
  sides?: ProductionSides | null;
  finishingNotes?: string | null;
  assignedToProfileId?: string | null;
  productionStatus?: ProductionStatus;
  synologySourcePath?: string | null;
};

export type ProductionBoardView = "active" | "archived";

export type ProductionBoardFilters = {
  search: string;
  companyId: string | null;
  assignedToProfileId: string | null;
  machine: string | null;
  material: string | null;
  priority: ProductionPriority | null;
  dueDate: "overdue" | "today" | "tomorrow" | null;
  jobReference: string | null;
  boardView: ProductionBoardView;
};
