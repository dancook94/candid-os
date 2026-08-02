import type { SupabaseClient } from "@supabase/supabase-js";

import { CRM_ROLES } from "@/lib/staff-roles";

export type CrmStaffProfile = {
  id: string;
  full_name: string | null;
  user_role: string;
  avatar_storage_path: string | null;
};

export async function loadCrmStaffProfiles(
  supabase: SupabaseClient
): Promise<CrmStaffProfile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, user_role, avatar_storage_path")
    .in("user_role", [...CRM_ROLES])
    .eq("account_status", "approved")
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as CrmStaffProfile[];
}

export function getStaffDisplayName(profile: {
  full_name: string | null;
  id?: string;
}) {
  return profile.full_name?.trim() || "Unnamed staff member";
}
