import type { SupabaseClient } from "@supabase/supabase-js";

import { isAdminRole, isStaffRole } from "@/lib/staff-roles";

export type StaffLeaveAuthProfile = {
  id: string;
  user_role: string;
  account_status: string;
};

export async function loadStaffLeaveAuthProfile(supabase: SupabaseClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false as const, status: 401, message: "Unauthorized." };
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, user_role, account_status")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    return { ok: false as const, status: 403, message: "Profile could not be loaded." };
  }

  return {
    ok: true as const,
    userId: user.id,
    profile: profile as StaffLeaveAuthProfile,
  };
}

export function canSubmitLeaveRequests(profile: StaffLeaveAuthProfile) {
  return profile.account_status === "approved" && isStaffRole(profile.user_role);
}

export function canDecideLeaveRequests(profile: StaffLeaveAuthProfile) {
  return profile.account_status === "approved" && isAdminRole(profile.user_role);
}

export function canRecordSickness(profile: StaffLeaveAuthProfile) {
  return canDecideLeaveRequests(profile);
}
