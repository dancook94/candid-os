import type { SupabaseClient } from "@supabase/supabase-js";

import {
  STAFF_AVATARS_BUCKET,
  buildStaffAvatarStoragePath,
  createStaffAvatarSignedUrl,
  deleteStaffAvatarObject,
  emptyStaffAvatarMetadata,
  validateStaffAvatarFile,
  type StaffAvatarMetadata,
} from "@/lib/staff-avatars";
import { isStaffRole } from "@/lib/staff-roles";
import { createAdminClient } from "@/lib/supabase/admin";

export async function loadStaffAvatarSignedUrl(
  supabase: SupabaseClient,
  profile: {
    user_role: string;
    avatar_storage_path?: string | null;
  }
) {
  if (!isStaffRole(profile.user_role) || !profile.avatar_storage_path) {
    return null;
  }

  try {
    const adminClient = createAdminClient();
    const signedUrl = await createStaffAvatarSignedUrl(
      adminClient,
      profile.avatar_storage_path
    );

    if (signedUrl) {
      return signedUrl;
    }
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("[staff-avatar] admin signed URL failed:", error);
    }
  }

  return createStaffAvatarSignedUrl(supabase, profile.avatar_storage_path);
}

export async function replaceStaffAvatar(
  supabase: SupabaseClient,
  {
    profileId,
    file,
    previousStoragePath,
  }: {
    profileId: string;
    file: File;
    previousStoragePath: string | null;
  }
): Promise<StaffAvatarMetadata> {
  const validationError = validateStaffAvatarFile(file);

  if (validationError) {
    throw new Error(validationError);
  }

  const storagePath = buildStaffAvatarStoragePath(profileId, file.name);

  const { error: uploadError } = await supabase.storage
    .from(STAFF_AVATARS_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    throw uploadError;
  }

  const metadata: StaffAvatarMetadata = {
    avatar_storage_path: storagePath,
    avatar_file_name: file.name,
    avatar_file_type: file.type || "application/octet-stream",
    avatar_file_size: file.size,
  };

  const { error: updateError } = await supabase
    .from("profiles")
    .update(metadata)
    .eq("id", profileId);

  if (updateError) {
    await deleteStaffAvatarObject(supabase, storagePath);
    throw updateError;
  }

  if (previousStoragePath && previousStoragePath !== storagePath) {
    try {
      await deleteStaffAvatarObject(supabase, previousStoragePath);
    } catch (cleanupError) {
      console.error("[staff-avatar] failed to delete replaced avatar", cleanupError);
    }
  }

  return metadata;
}

export async function removeStaffAvatar(
  supabase: SupabaseClient,
  {
    profileId,
    previousStoragePath,
  }: {
    profileId: string;
    previousStoragePath: string | null;
  }
) {
  const { error: updateError } = await supabase
    .from("profiles")
    .update(emptyStaffAvatarMetadata())
    .eq("id", profileId);

  if (updateError) {
    throw updateError;
  }

  if (previousStoragePath) {
    await deleteStaffAvatarObject(supabase, previousStoragePath);
  }
}
