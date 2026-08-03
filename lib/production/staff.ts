import { STAFF_ROLES } from "@/lib/staff-roles";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ProductionStaffProfile = {
  id: string;
  full_name: string | null;
  user_role: string;
};

export async function loadProductionStaffProfiles(
  supabase: SupabaseClient
): Promise<ProductionStaffProfile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, user_role")
    .in("user_role", [...STAFF_ROLES])
    .eq("account_status", "approved")
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ProductionStaffProfile[];
}

export async function loadProductionFilterOptions(
  adminClient: SupabaseClient
) {
  const { data, error } = await adminClient
    .from("production_items")
    .select("machine, material")
    .is("deleted_at", null);

  if (error) {
    return { machines: [] as string[], materials: [] as string[] };
  }

  const machines = new Set<string>();
  const materials = new Set<string>();

  for (const row of data ?? []) {
    if (row.machine?.trim()) machines.add(row.machine.trim());
    if (row.material?.trim()) materials.add(row.material.trim());
  }

  return {
    machines: [...machines].sort((a, b) => a.localeCompare(b)),
    materials: [...materials].sort((a, b) => a.localeCompare(b)),
  };
}
