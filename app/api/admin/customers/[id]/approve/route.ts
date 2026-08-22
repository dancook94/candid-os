import { NextResponse } from "next/server";

import { verifyApprovedCrmAdmin } from "@/lib/crm-auth";
import { notifyCustomerAccountApprovedSafe } from "@/lib/notifications/triggers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: profileId } = await context.params;
  const supabase = await createClient();
  const auth = await verifyApprovedCrmAdmin(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: { companyId?: string };

  try {
    body = (await request.json()) as { companyId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const companyId = body.companyId?.trim();

  if (!companyId) {
    return NextResponse.json({ error: "Company is required." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  const { data: existingProfile, error: profileError } = await adminClient
    .from("profiles")
    .select("id, user_role, account_status")
    .eq("id", profileId)
    .maybeSingle();

  if (profileError || !existingProfile) {
    return NextResponse.json({ error: "Customer profile not found." }, { status: 404 });
  }

  if (existingProfile.user_role !== "customer") {
    return NextResponse.json({ error: "Only customer profiles can be approved." }, { status: 400 });
  }

  if (existingProfile.account_status === "approved") {
    return NextResponse.json({ error: "Customer is already approved." }, { status: 400 });
  }

  const { error: approvalError } = await adminClient.rpc("approve_customer", {
    profile_id: profileId,
    selected_company_id: companyId,
  });

  if (approvalError) {
    return NextResponse.json({ error: approvalError.message }, { status: 400 });
  }

  void notifyCustomerAccountApprovedSafe(adminClient, profileId);

  return NextResponse.json({ ok: true, profileId });
}
