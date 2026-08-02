import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isStaffRole,
  isSuperAdminRole,
} from "@/lib/staff-roles";

type AuthFailure = { ok: false; status: number; message: string };

export type ApprovedStaffProfile = {
  id: string;
  full_name: string | null;
  user_role: string;
  account_status: string;
  avatar_storage_path: string | null;
};

type ApprovedStaffAuthResult =
  | { ok: true; userId: string; profile: ApprovedStaffProfile }
  | AuthFailure;

type SuperAdminStaffAvatarAuthResult =
  | {
      ok: true;
      userId: string;
      targetProfile: ApprovedStaffProfile;
    }
  | AuthFailure;

export async function verifyApprovedStaffMember(
  supabase: SupabaseClient
): Promise<ApprovedStaffAuthResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, status: 401, message: "Unauthorized." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, full_name, user_role, account_status, avatar_storage_path"
    )
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    profile.account_status !== "approved" ||
    !isStaffRole(profile.user_role)
  ) {
    return { ok: false, status: 403, message: "Forbidden." };
  }

  return { ok: true, userId: user.id, profile };
}

export async function verifySuperAdminStaffAvatarTarget(
  supabase: SupabaseClient,
  targetProfileId: string
): Promise<SuperAdminStaffAvatarAuthResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, status: 401, message: "Unauthorized." };
  }

  const { data: requesterProfile } = await supabase
    .from("profiles")
    .select("user_role, account_status")
    .eq("id", user.id)
    .single();

  if (
    !requesterProfile ||
    requesterProfile.account_status !== "approved" ||
    !isSuperAdminRole(requesterProfile.user_role)
  ) {
    return { ok: false, status: 403, message: "Forbidden." };
  }

  const { data: targetProfile } = await supabase
    .from("profiles")
    .select(
      "id, full_name, user_role, account_status, avatar_storage_path"
    )
    .eq("id", targetProfileId)
    .maybeSingle();

  if (!targetProfile || !isStaffRole(targetProfile.user_role)) {
    return { ok: false, status: 404, message: "Staff member not found." };
  }

  if (
    isSuperAdminRole(targetProfile.user_role) &&
    targetProfile.id !== user.id
  ) {
    return {
      ok: false,
      status: 403,
      message: "You cannot manage another super admin's avatar.",
    };
  }

  return { ok: true, userId: user.id, targetProfile };
}
