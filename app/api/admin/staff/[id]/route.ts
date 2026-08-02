import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { verifySuperAdmin } from "@/lib/admin-auth";
import { countActiveSuperAdmins } from "@/lib/staff-members";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  isInviteableStaffRole,
  isStaffRole,
  isSuperAdminRole,
} from "@/lib/staff-roles";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type UpdateStaffBody = {
  fullName?: string;
  role?: string;
  accountStatus?: "approved" | "disabled";
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id: staffId } = await context.params;
  const supabase = await createClient();
  const authResult = await verifySuperAdmin(supabase);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  let body: UpdateStaffBody;

  try {
    body = (await request.json()) as UpdateStaffBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
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

  const { data: targetProfile, error: targetError } = await adminClient
    .from("profiles")
    .select("id, full_name, user_role, account_status")
    .eq("id", staffId)
    .maybeSingle();

  if (targetError || !targetProfile) {
    return NextResponse.json({ error: "Staff member not found." }, { status: 404 });
  }

  if (!isStaffRole(targetProfile.user_role)) {
    return NextResponse.json(
      { error: "This profile is not a staff account." },
      { status: 400 }
    );
  }

  if (
    isSuperAdminRole(targetProfile.user_role) &&
    targetProfile.id !== authResult.userId
  ) {
    return NextResponse.json(
      { error: "You cannot edit another super admin account." },
      { status: 403 }
    );
  }

  const fullName = body.fullName?.trim();
  const role = body.role?.trim();
  const accountStatus = body.accountStatus;

  const updates: {
    full_name?: string;
    user_role?: string;
    account_status?: string;
  } = {};

  if (fullName) {
    updates.full_name = fullName;
  }

  if (role) {
    if (role === "super_admin") {
      return NextResponse.json(
        { error: "Super admin accounts cannot be assigned through staff management." },
        { status: 400 }
      );
    }

    if (!isInviteableStaffRole(role)) {
      return NextResponse.json({ error: "Invalid staff role." }, { status: 400 });
    }

    if (isSuperAdminRole(targetProfile.user_role)) {
      return NextResponse.json(
        { error: "Super admin role cannot be changed through staff management." },
        { status: 400 }
      );
    }

    updates.user_role = role;
  }

  if (accountStatus) {
    if (accountStatus !== "approved" && accountStatus !== "disabled") {
      return NextResponse.json({ error: "Invalid account status." }, { status: 400 });
    }

    if (
      accountStatus === "disabled" &&
      isSuperAdminRole(targetProfile.user_role) &&
      targetProfile.account_status === "approved"
    ) {
      const superAdminCount = await countActiveSuperAdmins();

      if (superAdminCount <= 1) {
        return NextResponse.json(
          { error: "Cannot deactivate the final super admin." },
          { status: 400 }
        );
      }
    }

    updates.account_status = accountStatus;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No valid updates were provided." },
      { status: 400 }
    );
  }

  const { error: updateError } = await adminClient
    .from("profiles")
    .update(updates)
    .eq("id", staffId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  revalidatePath("/admin/staff");
  revalidatePath(`/admin/staff/${staffId}`);

  return NextResponse.json({ success: true });
}
