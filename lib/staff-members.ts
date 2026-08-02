import { createAdminClient } from "@/lib/supabase/admin";
import { STAFF_ROLES } from "@/lib/staff-roles";

export type StaffMemberRecord = {
  id: string;
  full_name: string | null;
  user_role: string;
  account_status: string;
  created_at: string;
  email: string | null;
  last_sign_in_at: string | null;
};

export async function loadStaffMembersWithAuth(): Promise<StaffMemberRecord[]> {
  const adminClient = createAdminClient();

  const { data: profiles, error: profilesError } = await adminClient
    .from("profiles")
    .select("id, full_name, user_role, account_status, created_at")
    .in("user_role", [...STAFF_ROLES])
    .order("created_at", { ascending: false });

  if (profilesError || !profiles) {
    throw new Error(profilesError?.message ?? "Unable to load staff profiles.");
  }

  const staffMembers = await Promise.all(
    profiles.map(async (profile) => {
      const { data: authData, error: authError } =
        await adminClient.auth.admin.getUserById(profile.id);

      if (authError) {
        return {
          ...profile,
          email: null,
          last_sign_in_at: null,
        };
      }

      return {
        ...profile,
        email: authData.user.email ?? null,
        last_sign_in_at: authData.user.last_sign_in_at ?? null,
      };
    })
  );

  return staffMembers;
}

export async function countActiveSuperAdmins() {
  const adminClient = createAdminClient();

  const { count, error } = await adminClient
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .eq("user_role", "super_admin")
    .eq("account_status", "approved");

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}
