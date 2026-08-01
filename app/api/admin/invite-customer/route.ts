import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type InviteCustomerBody = {
  fullName?: string;
  email?: string;
  companyId?: string;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const authResult = await verifyApprovedAdmin(supabase);

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.message },
      { status: authResult.status }
    );
  }

  let body: InviteCustomerBody;

  try {
    body = (await request.json()) as InviteCustomerBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const fullName = body.fullName?.trim() ?? "";
  const email = body.email?.trim().toLowerCase() ?? "";
  const companyId = body.companyId?.trim() ?? "";

  if (!fullName) {
    return NextResponse.json(
      { error: "Full name is required." },
      { status: 400 }
    );
  }

  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  if (!companyId) {
    return NextResponse.json(
      { error: "Company is required." },
      { status: 400 }
    );
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, company_name, is_active")
    .eq("id", companyId)
    .maybeSingle();

  if (companyError || !company) {
    return NextResponse.json(
      { error: companyError?.message ?? "Company not found." },
      { status: 400 }
    );
  }

  if (!company.is_active) {
    return NextResponse.json(
      { error: "Selected company is not active." },
      { status: 400 }
    );
  }

  const requestUrl = new URL(request.url);
  const redirectTo = `${requestUrl.origin}/auth/callback`;

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
        company_name: company.company_name,
      },
      redirectTo,
    });

  if (inviteError || !inviteData.user) {
    return NextResponse.json(
      { error: inviteError?.message ?? "Unable to send invitation email." },
      { status: 400 }
    );
  }

  const { error: profileError } = await adminClient.from("profiles").upsert(
    {
      id: inviteData.user.id,
      full_name: fullName,
      company_id: company.id,
      requested_company_name: company.company_name,
      account_status: "approved",
      user_role: "customer",
    },
    { onConflict: "id" }
  );

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    message: `Invitation sent to ${email}.`,
  });
}
