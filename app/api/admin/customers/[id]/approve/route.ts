import { NextResponse } from "next/server";

import { approveCustomerProfile } from "@/lib/admin/approve-customer";
import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { notifyCustomerAccountApprovedSafe } from "@/lib/notifications/triggers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: profileId } = await context.params;
  const supabase = await createClient();
  const auth = await verifyApprovedAdmin(supabase);

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

  const approval = await approveCustomerProfile(supabase, {
    profileId,
    companyId,
  });

  if (!approval.ok) {
    return NextResponse.json(
      { error: approval.message },
      { status: approval.status }
    );
  }

  const adminClient = createAdminClient();
  void notifyCustomerAccountApprovedSafe(adminClient, profileId);

  return NextResponse.json({ ok: true, profileId });
}
