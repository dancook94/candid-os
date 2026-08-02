import type { SupabaseClient } from "@supabase/supabase-js";

import { loadStaffAvatarSignedUrl } from "@/lib/staff-avatar-server";
import { isAdminRole, isSuperAdminRole } from "@/lib/staff-roles";

export type AdminShellProfile = {
  full_name: string | null;
  user_role: string;
  avatar_storage_path?: string | null;
};

type AppShellPropsOptions = {
  avatarSignedUrl?: string | null;
};

async function resolveAvatarSignedUrl(
  supabase: SupabaseClient,
  profile: AdminShellProfile,
  avatarSignedUrl?: string | null
) {
  if (avatarSignedUrl !== undefined) {
    return avatarSignedUrl;
  }

  return loadStaffAvatarSignedUrl(supabase, {
    user_role: profile.user_role,
    avatar_storage_path: profile.avatar_storage_path,
  });
}

export async function buildAdminAppShellProps(
  supabase: SupabaseClient,
  profile: AdminShellProfile,
  options?: AppShellPropsOptions
) {
  return {
    userRole: "admin" as const,
    showStaffNav: isSuperAdminRole(profile.user_role),
    userName: profile.full_name || "Candid administrator",
    companyName: "Candid Creative",
    userAvatarUrl: await resolveAvatarSignedUrl(
      supabase,
      profile,
      options?.avatarSignedUrl
    ),
  };
}

export async function buildStaffAppShellProps(
  supabase: SupabaseClient,
  profile: AdminShellProfile,
  options?: AppShellPropsOptions
) {
  return {
    userRole: "staff" as const,
    userName: profile.full_name || "Candid team member",
    companyName: "Candid Creative",
    userAvatarUrl: await resolveAvatarSignedUrl(
      supabase,
      profile,
      options?.avatarSignedUrl
    ),
  };
}

export async function buildPortalAppShellProps(
  supabase: SupabaseClient,
  profile: AdminShellProfile,
  options?: AppShellPropsOptions
) {
  if (isAdminRole(profile.user_role)) {
    return buildAdminAppShellProps(supabase, profile, options);
  }

  return buildStaffAppShellProps(supabase, profile, options);
}
