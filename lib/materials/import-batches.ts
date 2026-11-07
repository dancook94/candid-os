import { INITIAL_IMPORT_CATALOG_VERSION } from "@/lib/materials/initial-import-catalog";
import type { InitialImportPlan } from "@/lib/materials/initial-import-plan";
import { MEDIUM_IMPORT_CATALOG_VERSION } from "@/lib/materials/medium-import-catalog";

export const APPROVED_IMPORT_CATALOG_VERSIONS = [
  INITIAL_IMPORT_CATALOG_VERSION,
  MEDIUM_IMPORT_CATALOG_VERSION,
] as const;

export type ApprovedImportCatalogVersion =
  (typeof APPROVED_IMPORT_CATALOG_VERSIONS)[number];

export type MaterialImportRunStatus = {
  runsReady: boolean;
  completedCatalogVersions: string[];
};

export function parseApprovedImportCatalogVersion(
  value: unknown
): ApprovedImportCatalogVersion | null {
  if (typeof value !== "string") {
    return null;
  }

  return (APPROVED_IMPORT_CATALOG_VERSIONS as readonly string[]).includes(value)
    ? (value as ApprovedImportCatalogVersion)
    : null;
}

export function batchImportLabel(version: ApprovedImportCatalogVersion) {
  if (version === INITIAL_IMPORT_CATALOG_VERSION) {
    return "Batch 1 — initial-approved-46 (46 materials)";
  }

  return "Batch 2 — medium-approved-batch-2 (36 materials)";
}

export function applyBatchImportGuards(
  plan: InitialImportPlan,
  status: MaterialImportRunStatus
): InitialImportPlan {
  const batch1Done = status.completedCatalogVersions.includes(
    INITIAL_IMPORT_CATALOG_VERSION
  );

  if (plan.catalogVersion !== MEDIUM_IMPORT_CATALOG_VERSION || batch1Done) {
    return {
      ...plan,
      importStatus: {
        runsReady: status.runsReady,
        completedCatalogVersions: status.completedCatalogVersions,
        batch1Completed: batch1Done,
      },
    };
  }

  const dependencyReason =
    "Batch 1 (initial-approved-46) must complete successfully before batch 2 can be committed.";

  const warnings = [...plan.warnings];

  if (!status.runsReady) {
    warnings.push(
      "Import history could not be loaded. Batch 2 commit stays blocked until batch 1 is recorded."
    );
  } else {
    warnings.push(
      "No successful batch 1 import is recorded in material_import_runs yet."
    );
  }

  return {
    ...plan,
    canCommit: false,
    blockedReason: plan.blockedReason ?? dependencyReason,
    warnings,
    importStatus: {
      runsReady: status.runsReady,
      completedCatalogVersions: status.completedCatalogVersions,
      batch1Completed: false,
    },
  };
}

export type ImportPlanSummarySection = {
  title: string;
  rows: Array<{ label: string; detail: string }>;
};

export function buildImportPlanSummary(
  plan: InitialImportPlan
): ImportPlanSummarySection[] {
  const supplierConflicts = plan.suppliers
    .filter((row) => row.action === "conflict")
    .map((row) => ({
      label: row.name,
      detail: row.note,
    }));

  const aliasConflicts = plan.aliases
    .filter((row) => row.action === "conflict")
    .map((row) => ({
      label: `${row.alias} → ${row.canonicalName}`,
      detail: row.note,
    }));

  const newMaterials = plan.materials
    .filter((row) => row.action === "create")
    .map((row) => ({
      label: row.name,
      detail: row.note,
    }));

  const extensions = plan.materials
    .filter((row) => row.action === "extend")
    .map((row) => ({
      label: row.name,
      detail: row.note,
    }));

  const matchedMaterials = plan.materials
    .filter((row) => row.action === "already_matched")
    .map((row) => ({
      label: row.name,
      detail: row.note,
    }));

  const materialConflicts = plan.materials
    .filter((row) => row.action === "conflict" || row.action === "invalid")
    .map((row) => ({
      label: row.name,
      detail: row.note,
    }));

  const preferredConflicts = plan.materials.flatMap((material) =>
    material.products
      .filter(
        (product) =>
          product.action === "conflict" &&
          product.note.toLowerCase().includes("preferred")
      )
      .map((product) => ({
        label: `${material.name} — ${product.supplierName}`,
        detail: product.note,
      }))
  );

  const descriptionConflicts = plan.materials.flatMap((material) =>
    material.products
      .filter(
        (product) =>
          product.action === "conflict" &&
          product.note.toLowerCase().includes("description")
      )
      .map((product) => ({
        label: `${material.name} — ${product.supplierName}`,
        detail: product.note,
      }))
  );

  const duplicateRisks = plan.materials
    .filter((row) => row.action === "create")
    .flatMap((material) =>
      material.products
        .filter((product) => product.action === "create")
        .map((product) => ({
          label: `${material.name} — ${product.supplierName}`,
          detail:
            "New canonical material or product. Confirm the identity key does not overlap an existing Test row.",
        }))
    );

  const priceConflicts = plan.materials.flatMap((material) =>
    material.products
      .filter(
        (product) =>
          product.action === "conflict" &&
          product.note.toLowerCase().includes("price")
      )
      .map((product) => ({
        label: `${material.name} — ${product.supplierName}`,
        detail: product.note,
      }))
  );

  return [
    { title: "Supplier conflicts", rows: supplierConflicts },
    { title: "Supplier alias conflicts", rows: aliasConflicts },
    { title: "Preferred supplier conflicts", rows: preferredConflicts },
    { title: "Description ownership conflicts", rows: descriptionConflicts },
    { title: "Opening price conflicts", rows: priceConflicts },
    { title: "Blocked materials", rows: materialConflicts },
    { title: "New materials", rows: newMaterials },
    { title: "Duplicate risks (new rows)", rows: duplicateRisks },
    { title: "Existing material matches", rows: matchedMaterials },
    { title: "Extensions to existing materials", rows: extensions },
  ].filter((section) => section.rows.length > 0);
}
