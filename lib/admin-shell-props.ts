import type { SupabaseClient } from "@supabase/supabase-js";

import { loadStaffAvatarSignedUrl } from "@/lib/staff-avatar-server";
import { isAdminRole, isCrmRole, isSuperAdminRole } from "@/lib/staff-roles";
import { fetchUnreadProductUpdateCount } from "@/lib/updates/queries";

export type AdminShellProfile = {
  full_name: string | null;
  user_role: string;
  avatar_storage_path?: string | null;
};

type AppShellPropsOptions = {
  avatarSignedUrl?: string | null;
  userId?: string;
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

async function resolveUserId(
  supabase: SupabaseClient,
  userId?: string
) {
  if (userId) {
    return userId;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id;
}

export async function buildAdminAppShellProps(
  supabase: SupabaseClient,
  profile: AdminShellProfile,
  options?: AppShellPropsOptions
) {
  const resolvedUserId = await resolveUserId(supabase, options?.userId);
  const updatesUnreadCount = resolvedUserId
    ? (
        await fetchUnreadProductUpdateCount(
          supabase,
          resolvedUserId,
          profile.user_role
        )
      ).count
    : 0;

  return {
    userRole: "admin" as const,
    showStaffNav: isSuperAdminRole(profile.user_role),
    showCrmNav: isAdminRole(profile.user_role),
    userName: profile.full_name || "Candid administrator",
    companyName: "Candid Creative",
    updatesUnreadCount,
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
  const resolvedUserId = await resolveUserId(supabase, options?.userId);
  const updatesUnreadCount = resolvedUserId
    ? (
        await fetchUnreadProductUpdateCount(
          supabase,
          resolvedUserId,
          profile.user_role
        )
      ).count
    : 0;

  return {
    userRole: "staff" as const,
    userName: profile.full_name || "Candid team member",
    companyName: "Candid Creative",
    updatesUnreadCount,
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

export async function buildCrmAppShellProps(
  supabase: SupabaseClient,
  profile: AdminShellProfile,
  options?: AppShellPropsOptions
) {
  if (isAdminRole(profile.user_role)) {
    return buildAdminAppShellProps(supabase, profile, options);
  }

  if (isCrmRole(profile.user_role)) {
    const resolvedUserId = await resolveUserId(supabase, options?.userId);
    const updatesUnreadCount = resolvedUserId
      ? (
          await fetchUnreadProductUpdateCount(
            supabase,
            resolvedUserId,
            profile.user_role
          )
        ).count
      : 0;

    return {
      userRole: "staff" as const,
      showStaffNav: false,
      showCrmNav: true,
      userName: profile.full_name || "Candid team member",
      companyName: "Candid Creative",
      updatesUnreadCount,
      userAvatarUrl: await resolveAvatarSignedUrl(
        supabase,
        profile,
        options?.avatarSignedUrl
      ),
    };
  }

  return buildStaffAppShellProps(supabase, profile, options);
}
