import type { SupabaseClient } from "@supabase/supabase-js";

import { getStaffDisplayName } from "@/lib/crm/crm-staff";
import { loadStaffAvatarSignedUrl } from "@/lib/staff-avatar-server";

export const CRM_ACTIVITY_ACTOR_PROFILE_ID_FKEY =
  "crm_activity_actor_profile_id_fkey";

export const CRM_ACTIVITY_ACTOR_PROFILE_SELECT =
  "id, full_name, user_role, avatar_storage_path, avatar_file_name, avatar_file_type";

export type CrmActivityActorRecord = {
  id: string;
  full_name: string | null;
  user_role: string;
  avatar_storage_path: string | null;
  avatar_file_name: string | null;
  avatar_file_type: string | null;
};

export type CrmActivityActorView = {
  id: string;
  name: string;
  role: string | null;
  avatarUrl: string | null;
};

export function buildCrmActivityActorEmbedSelect() {
  return `actor:profiles!${CRM_ACTIVITY_ACTOR_PROFILE_ID_FKEY}(${CRM_ACTIVITY_ACTOR_PROFILE_SELECT})`;
}

export function normalizeCrmActivityActorEmbed(
  actor: CrmActivityActorRecord | CrmActivityActorRecord[] | null | undefined
): CrmActivityActorRecord | null {
  if (!actor) {
    return null;
  }

  return Array.isArray(actor) ? (actor[0] ?? null) : actor;
}

export async function resolveCrmActivityActorAvatarUrls(
  supabase: SupabaseClient,
  profiles: CrmActivityActorRecord[]
) {
  const uniqueProfiles = [
    ...new Map(profiles.map((profile) => [profile.id, profile])).values(),
  ];

  const entries = await Promise.all(
    uniqueProfiles.map(async (profile) => [
      profile.id,
      await loadStaffAvatarSignedUrl(supabase, profile),
    ] as const)
  );

  return new Map(entries);
}

export function toCrmActivityActorView(
  profile: CrmActivityActorRecord,
  avatarUrl: string | null
): CrmActivityActorView {
  return {
    id: profile.id,
    name: getStaffDisplayName(profile),
    role: profile.user_role ?? null,
    avatarUrl,
  };
}

export async function loadCrmActivityActorProfiles(
  supabase: SupabaseClient,
  profileIds: string[]
): Promise<Map<string, CrmActivityActorView>> {
  if (profileIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("profiles")
    .select(CRM_ACTIVITY_ACTOR_PROFILE_SELECT)
    .in("id", profileIds);

  if (error) {
    throw new Error(error.message);
  }

  const profiles = (data ?? []) as CrmActivityActorRecord[];
  const avatarUrlById = await resolveCrmActivityActorAvatarUrls(
    supabase,
    profiles
  );

  return new Map(
    profiles.map((profile) => [
      profile.id,
      toCrmActivityActorView(profile, avatarUrlById.get(profile.id) ?? null),
    ])
  );
}

export async function buildCrmActivityActorViewsFromEmbed(
  supabase: SupabaseClient,
  actors: Array<CrmActivityActorRecord | null | undefined>
) {
  const uniqueActors = [
    ...new Map(
      actors
        .filter((actor): actor is CrmActivityActorRecord => Boolean(actor))
        .map((actor) => [actor.id, actor])
    ).values(),
  ];

  const avatarUrlById = await resolveCrmActivityActorAvatarUrls(
    supabase,
    uniqueActors
  );

  return new Map(
    uniqueActors.map((profile) => [
      profile.id,
      toCrmActivityActorView(profile, avatarUrlById.get(profile.id) ?? null),
    ])
  );
}
