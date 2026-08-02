import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  removeStaffAvatar,
  replaceStaffAvatar,
} from "@/lib/staff-avatar-server";
import { verifySuperAdminStaffAvatarTarget } from "@/lib/staff-avatar-auth";
import {
  createStaffAvatarSignedUrl,
  formatStaffAvatarStorageError,
} from "@/lib/staff-avatars";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id: staffId } = await context.params;
  const supabase = await createClient();
  const authResult = await verifySuperAdminStaffAvatarTarget(supabase, staffId);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload payload." }, { status: 400 });
  }

  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Avatar file is required." }, { status: 400 });
  }

  let adminClient;

  try {
    adminClient = createAdminClient();
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to initialise admin client.",
      },
      { status: 500 }
    );
  }

  try {
    const metadata = await replaceStaffAvatar(adminClient, {
      profileId: authResult.targetProfile.id,
      file,
      previousStoragePath: authResult.targetProfile.avatar_storage_path,
    });

    const previewUrl = metadata.avatar_storage_path
      ? await createStaffAvatarSignedUrl(
          adminClient,
          metadata.avatar_storage_path
        )
      : null;

    revalidatePath("/admin/staff");
    revalidatePath(`/admin/staff/${staffId}`);

    return NextResponse.json({ success: true, previewUrl });
  } catch (error) {
    return NextResponse.json(
      { error: formatStaffAvatarStorageError(error) },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id: staffId } = await context.params;
  const supabase = await createClient();
  const authResult = await verifySuperAdminStaffAvatarTarget(supabase, staffId);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  let adminClient;

  try {
    adminClient = createAdminClient();
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to initialise admin client.",
      },
      { status: 500 }
    );
  }

  try {
    await removeStaffAvatar(adminClient, {
      profileId: authResult.targetProfile.id,
      previousStoragePath: authResult.targetProfile.avatar_storage_path,
    });

    revalidatePath("/admin/staff");
    revalidatePath(`/admin/staff/${staffId}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: formatStaffAvatarStorageError(error) },
      { status: 400 }
    );
  }
}
