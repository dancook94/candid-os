import { NextResponse } from "next/server";

import { notifyCustomerRegistrationSafe } from "@/lib/notifications/triggers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, user_role, account_status")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  if (profile.user_role !== "customer") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const adminClient = createAdminClient();
  const notification = await notifyCustomerRegistrationSafe(
    adminClient,
    profile.id as string
  );

  return NextResponse.json({
    ok: true,
    profileId: profile.id,
    notification: {
      ok: notification.ok,
      skippedReason: "skippedReason" in notification ? notification.skippedReason : null,
    },
  });
}
