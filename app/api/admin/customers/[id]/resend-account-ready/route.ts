import { NextResponse } from "next/server";

import { verifyApprovedAdmin } from "@/lib/admin-auth";
import { notifyCustomerAccountApprovedSafe } from "@/lib/notifications/triggers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: profileId } = await context.params;
  const supabase = await createClient();
  const auth = await verifyApprovedAdmin(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, user_role, account_status")
    .eq("id", profileId)
    .maybeSingle();

  if (profileError || !profile) {
    return NextResponse.json({ error: "Customer profile not found." }, { status: 404 });
  }

  if (profile.user_role !== "customer") {
    return NextResponse.json(
      { error: "Only customer profiles can receive account-ready emails." },
      { status: 400 }
    );
  }

  if (profile.account_status !== "approved") {
    return NextResponse.json(
      { error: "Customer must be approved before resending the account-ready email." },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();
  const notification = await notifyCustomerAccountApprovedSafe(adminClient, profileId, {
    resend: true,
  });

  if (process.env.NODE_ENV === "development") {
    console.info("[resend-account-ready] notification", {
      profileId,
      ok: notification.ok,
      skippedReason: "skippedReason" in notification ? notification.skippedReason : null,
      notificationIds:
        "notificationIds" in notification ? notification.notificationIds : [],
    });
  }

  return NextResponse.json({
    ok: notification.ok,
    profileId,
    notification: {
      ok: notification.ok,
      skippedReason: "skippedReason" in notification ? notification.skippedReason : null,
      notificationIds:
        "notificationIds" in notification ? notification.notificationIds : [],
    },
  });
}
