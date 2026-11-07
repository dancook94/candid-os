import { revalidatePath } from "next/cache";

import type { SupabaseClient } from "@supabase/supabase-js";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import {
  applyBatchImportGuards,
  type ApprovedImportCatalogVersion,
  type MaterialImportRunStatus,
} from "@/lib/materials/import-batches";
import {
  buildInitialImportPayload,
  buildInitialImportPlan,
  isInitialImportConfirmation,
  resolveCatalogImportSource,
  type InitialImportPlan,
  type InitialImportSnapshot,
} from "@/lib/materials/initial-import-plan";
import { createClient } from "@/lib/supabase/server";
import { isMaterialsSchemaMissing } from "@/lib/materials/write-error";

type ImportFailure = {
  ok: false;
  status: number;
  error: string;
  plan?: InitialImportPlan;
};

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function numeric(value: unknown) {
  if (value == null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function refreshMaterials() {
  revalidatePath("/admin/materials");
  revalidatePath("/admin/materials/import");
  revalidatePath("/admin/materials/suppliers");
}

async function requireImporter() {
  const supabase = await createClient();
  const auth = await verifyApprovedAdmin(supabase);

  if (!auth.ok) {
    return {
      ok: false as const,
      status: auth.status,
      error: auth.message,
    };
  }

  return { ok: true as const, supabase };
}

export async function loadInitialImportSnapshot(
  supabase: SupabaseClient
): Promise<{ ok: true; data: InitialImportSnapshot } | ImportFailure> {
  const [suppliers, materials, products, prices, aliases] = await Promise.all([
    supabase.from("suppliers").select("id, name, normalized_name"),
    supabase
      .from("materials")
      .select("id, name, identity_key, active"),
    supabase
      .from("material_supplier_products")
      .select(
        "id, material_id, supplier_id, supplier_description, normalized_description, is_preferred, active"
      ),
    supabase
      .from("material_prices")
      .select("material_supplier_product_id, price, price_unit"),
    supabase.from("supplier_aliases").select("supplier_id, alias, normalized_alias"),
  ]);

  if (suppliers.error || materials.error || products.error || prices.error) {
    const error = suppliers.error ?? materials.error ?? products.error ?? prices.error;
    return {
      ok: false,
      status: 500,
      error: isMaterialsSchemaMissing(error)
        ? "Material tables are not in this database yet. Apply the materials migration, then reload."
        : "Materials could not be loaded for the dry import.",
    };
  }

  const aliasesReady = !aliases.error;
  const aliasRows = aliasesReady ? aliases.data ?? [] : [];

  if (
    aliases.error &&
    !isMaterialsSchemaMissing(aliases.error)
  ) {
    return {
      ok: false,
      status: 500,
      error: "Supplier aliases could not be loaded.",
    };
  }

  return {
    ok: true,
    data: {
      aliasesReady,
      suppliers: (suppliers.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        normalizedName: row.normalized_name,
      })),
      aliases: aliasRows.map((row) => ({
        supplierId: row.supplier_id,
        alias: row.alias,
        normalizedAlias: row.normalized_alias,
      })),
      materials: (materials.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        identityKey: row.identity_key,
        active: row.active,
      })),
      products: (products.data ?? []).map((row) => ({
        id: row.id,
        materialId: row.material_id,
        supplierId: row.supplier_id,
        description: row.supplier_description,
        normalizedDescription: row.normalized_description,
        isPreferred: row.is_preferred,
        active: row.active,
      })),
      prices: (prices.data ?? []).flatMap((row) => {
        const price = numeric(row.price);

        if (price == null) {
          return [];
        }

        return [
          {
            productId: row.material_supplier_product_id,
            price,
            priceUnit: row.price_unit,
          },
        ];
      }),
    },
  };
}

async function loadMaterialImportRunStatus(
  supabase: SupabaseClient
): Promise<MaterialImportRunStatus> {
  const runs = await supabase.from("material_import_runs").select("catalog_version");

  if (runs.error) {
    if (isMaterialsSchemaMissing(runs.error)) {
      return { runsReady: false, completedCatalogVersions: [] };
    }

    return { runsReady: false, completedCatalogVersions: [] };
  }

  const completedCatalogVersions = [
    ...new Set(
      (runs.data ?? [])
        .map((row) => row.catalog_version)
        .filter((value): value is string => typeof value === "string")
    ),
  ];

  return { runsReady: true, completedCatalogVersions };
}

function buildApprovedImportPlan(
  snapshot: InitialImportSnapshot,
  catalogVersion: ApprovedImportCatalogVersion,
  importStatus: MaterialImportRunStatus,
  effectiveDate: string
) {
  const plan = buildInitialImportPlan(
    snapshot,
    effectiveDate,
    resolveCatalogImportSource(catalogVersion)
  );

  return applyBatchImportGuards(plan, importStatus);
}

export async function previewInitialMaterialImport(
  catalogVersion: ApprovedImportCatalogVersion
): Promise<
  { ok: true; plan: InitialImportPlan } | ImportFailure
> {
  const access = await requireImporter();

  if (!access.ok) {
    return access;
  }

  const snapshot = await loadInitialImportSnapshot(access.supabase);

  if (!snapshot.ok) {
    return snapshot;
  }

  const importStatus = await loadMaterialImportRunStatus(access.supabase);

  return {
    ok: true,
    plan: buildApprovedImportPlan(snapshot.data, catalogVersion, importStatus, utcToday()),
  };
}

function commitError(error: { code?: string; message?: string }) {
  const message = error.message ?? "";

  if (
    isMaterialsSchemaMissing(error) ||
    message.includes("apply_initial_materials_import") ||
    message.includes("schema cache")
  ) {
    return "Apply the supplier aliases migration in Supabase, then run the dry import again.";
  }

  if (message && message.length <= 300) {
    return message;
  }

  return "The import was not saved.";
}

export async function commitInitialMaterialImport(
  confirmation: unknown,
  catalogVersion: ApprovedImportCatalogVersion
): Promise<
  { ok: true; result: unknown; plan: InitialImportPlan } | ImportFailure
> {
  if (!isInitialImportConfirmation(confirmation)) {
    return {
      ok: false,
      status: 400,
      error: "Confirm the dry import before anything is written.",
    };
  }

  const access = await requireImporter();

  if (!access.ok) {
    return access;
  }

  const snapshot = await loadInitialImportSnapshot(access.supabase);

  if (!snapshot.ok) {
    return snapshot;
  }

  const effectiveDate = utcToday();
  const importStatus = await loadMaterialImportRunStatus(access.supabase);
  const plan = buildApprovedImportPlan(snapshot.data, catalogVersion, importStatus, effectiveDate);

  if (!plan.canCommit) {
    return {
      ok: false,
      status: 409,
      error: plan.blockedReason ?? "This import cannot run.",
      plan,
    };
  }

  const payload = buildInitialImportPayload(plan, effectiveDate);

  if (!payload) {
    return {
      ok: false,
      status: 409,
      error: "This import cannot run.",
      plan,
    };
  }

  const { data, error } = await access.supabase.rpc(
    "apply_initial_materials_import",
    { p_payload: payload }
  );

  if (error) {
    return {
      ok: false,
      status: 409,
      error: commitError(error),
      plan,
    };
  }

  refreshMaterials();

  return { ok: true, result: data, plan };
}
