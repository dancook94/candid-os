import { NextResponse } from "next/server";

import { verifySuperAdmin } from "@/lib/admin-auth";
import { buildInvitePasswordSetupRedirect } from "@/lib/auth-invite-redirect";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isInviteableStaffRole } from "@/lib/staff-roles";

type InviteStaffBody = {
  fullName?: string;
  email?: string;
  role?: string;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const authResult = await verifySuperAdmin(supabase);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  let body: InviteStaffBody;

  try {
    body = (await request.json()) as InviteStaffBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const fullName = body.fullName?.trim() ?? "";
  const email = body.email?.trim().toLowerCase() ?? "";
  const role = body.role?.trim() ?? "";

  if (!fullName) {
    return NextResponse.json(
      { error: "Full name is required." },
      { status: 400 }
    );
  }

  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  if (!isInviteableStaffRole(role)) {
    return NextResponse.json({ error: "Invalid staff role." }, { status: 400 });
  }

  const requestUrl = new URL(request.url);
  const redirectTo = buildInvitePasswordSetupRedirect(requestUrl.origin);

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

  const { data: inviteData, error: inviteError } =
    await adminClient.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name: fullName,
      },
      redirectTo,
    });

  if (inviteError || !inviteData.user) {
    return NextResponse.json(
      { error: inviteError?.message ?? "Unable to send invitation email." },
      { status: 400 }
    );
  }

  const invitedUserId = inviteData.user.id;

  const { error: profileError } = await adminClient.from("profiles").upsert(
    {
      id: invitedUserId,
      full_name: fullName,
      company_id: null,
      requested_company_name: null,
      account_status: "approved",
      user_role: role,
    },
    { onConflict: "id" }
  );

  if (profileError) {
    await adminClient.auth.admin.deleteUser(invitedUserId);

    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    message: `Invitation sent to ${email}.`,
  });
}
