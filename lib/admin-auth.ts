import type { SupabaseClient } from "@supabase/supabase-js";

import { isCandidAdminRole, isSuperAdminRole } from "@/lib/staff-roles";

type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; message: string };

export async function verifyApprovedAdmin(
  supabase: SupabaseClient
): Promise<AuthResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, status: 401, message: "Unauthorized." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("user_role, account_status")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    !isCandidAdminRole(profile.user_role) ||
    profile.account_status !== "approved"
  ) {
    return { ok: false, status: 403, message: "Forbidden." };
  }

  return { ok: true, userId: user.id };
}

export async function verifySuperAdmin(
  supabase: SupabaseClient
): Promise<AuthResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, status: 401, message: "Unauthorized." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("user_role, account_status")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    !isSuperAdminRole(profile.user_role) ||
    profile.account_status !== "approved"
  ) {
    return { ok: false, status: 403, message: "Forbidden." };
  }

  return { ok: true, userId: user.id };
}
