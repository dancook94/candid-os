import type { SupabaseClient } from "@supabase/supabase-js";

import { getStaffDisplayName } from "@/lib/crm/crm-staff";
import { CRM_ROLES } from "@/lib/staff-roles";

export type ValidatedCrmStaffProfile = {
  id: string;
  full_name: string | null;
  user_role: string;
};

export async function validateCrmStaffProfileIds(
  supabase: SupabaseClient,
  profileIds: string[]
): Promise<
  | { ok: true; profiles: ValidatedCrmStaffProfile[] }
  | { ok: false; message: string }
> {
  const uniqueIds = [...new Set(profileIds.filter(Boolean))];

  if (uniqueIds.length === 0) {
    return { ok: false, message: "At least one staff member is required." };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, user_role, account_status")
    .in("id", uniqueIds);

  if (error) {
    return { ok: false, message: error.message };
  }

  const profiles = data ?? [];

  if (profiles.length !== uniqueIds.length) {
    return { ok: false, message: "One or more staff members were not found." };
  }

  for (const profile of profiles) {
    if (
      profile.account_status !== "approved" ||
      !(CRM_ROLES as readonly string[]).includes(profile.user_role)
    ) {
      return {
        ok: false,
        message: `${getStaffDisplayName(profile)} is not approved CRM staff.`,
      };
    }
  }

  return {
    ok: true,
    profiles: profiles.map((profile) => ({
      id: profile.id,
      full_name: profile.full_name,
      user_role: profile.user_role,
    })),
  };
}
