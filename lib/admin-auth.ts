import type { SupabaseClient } from "@supabase/supabase-js";

type AdminAuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; message: string };

export async function verifyApprovedAdmin(
  supabase: SupabaseClient
): Promise<AdminAuthResult> {
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
    profile.user_role !== "admin" ||
    profile.account_status !== "approved"
  ) {
    return { ok: false, status: 403, message: "Forbidden." };
  }

  return { ok: true, userId: user.id };
}
