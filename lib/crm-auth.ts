import type { SupabaseClient } from "@supabase/supabase-js";

import { isCrmRole } from "@/lib/staff-roles";

type AuthResult =
  | { ok: true; userId: string; userRole: string }
  | { ok: false; status: number; message: string };

export async function verifyApprovedCrmStaff(
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
    profile.account_status !== "approved" ||
    !isCrmRole(profile.user_role)
  ) {
    return { ok: false, status: 403, message: "Forbidden." };
  }

  return { ok: true, userId: user.id, userRole: profile.user_role };
}

export async function verifyApprovedCrmAdmin(
  supabase: SupabaseClient
): Promise<AuthResult> {
  const authResult = await verifyApprovedCrmStaff(supabase);

  if (!authResult.ok) {
    return authResult;
  }

  if (!["super_admin", "admin"].includes(authResult.userRole)) {
    return { ok: false, status: 403, message: "Forbidden." };
  }

  return authResult;
}
