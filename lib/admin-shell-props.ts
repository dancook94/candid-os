import type { SupabaseClient } from "@supabase/supabase-js";

import { loadStaffAvatarSignedUrl } from "@/lib/staff-avatar-server";
import { isSuperAdminRole } from "@/lib/staff-roles";

export type AdminShellProfile = {
  full_name: string | null;
  user_role: string;
  avatar_storage_path?: string | null;
};

export async function buildAdminAppShellProps(
  supabase: SupabaseClient,
  profile: AdminShellProfile
) {
  return {
    userRole: "admin" as const,
    showStaffNav: isSuperAdminRole(profile.user_role),
    userName: profile.full_name || "Candid administrator",
    companyName: "Candid Creative",
    userAvatarUrl: await loadStaffAvatarSignedUrl(supabase, {
      user_role: profile.user_role,
      avatar_storage_path: profile.avatar_storage_path,
    }),
  };
}

export async function buildStaffAppShellProps(
  supabase: SupabaseClient,
  profile: AdminShellProfile
) {
  return {
    userRole: "staff" as const,
    userName: profile.full_name || "Candid team member",
    companyName: "Candid Creative",
    userAvatarUrl: await loadStaffAvatarSignedUrl(supabase, {
      user_role: profile.user_role,
      avatar_storage_path: profile.avatar_storage_path,
    }),
  };
}
