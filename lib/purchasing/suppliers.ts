import type { SupabaseClient } from "@supabase/supabase-js";

export type PurchasingSupplier = {
  id: string;
  name: string;
};

export function filterPurchasingSuppliers(
  suppliers: PurchasingSupplier[],
  query: string
) {
  const needle = query.trim().toLowerCase();

  if (!needle) {
    return suppliers;
  }

  return suppliers.filter((supplier) =>
    supplier.name.toLowerCase().includes(needle)
  );
}

export async function loadActiveSuppliers(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name, active")
    .eq("active", true)
    .order("name");

  if (error) {
    return {
      suppliers: [] as PurchasingSupplier[],
      errorMessage: "Suppliers could not be loaded.",
    };
  }

  const suppliers = ((data ?? []) as unknown[]).flatMap((value) => {
    if (!value || typeof value !== "object") {
      return [];
    }

    const row = value as {
      id?: unknown;
      name?: unknown;
      active?: unknown;
    };

    if (
      typeof row.id !== "string" ||
      typeof row.name !== "string" ||
      row.active === false
    ) {
      return [];
    }

    const name = row.name.trim();

    if (!name) {
      return [];
    }

    return [{ id: row.id, name }];
  });

  return {
    suppliers,
    errorMessage: null,
  };
}
