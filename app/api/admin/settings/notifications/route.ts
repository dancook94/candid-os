import { NextResponse } from "next/server";

import { verifyApprovedCrmAdmin } from "@/lib/crm-auth";
import {
  getDefaultNotificationSettings,
  normalizeNotificationSettings,
} from "@/lib/notifications/settings";
import {
  loadNotificationSettings,
  saveNotificationSettings,
} from "@/lib/notifications/settings-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const auth = await verifyApprovedCrmAdmin(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const adminClient = createAdminClient();

  try {
    const settings = await loadNotificationSettings(adminClient);
    return NextResponse.json({ settings });
  } catch (error) {
    return NextResponse.json(
      {
        settings: getDefaultNotificationSettings(),
        error: error instanceof Error ? error.message : "Unable to load settings.",
      },
      { status: 200 }
    );
  }
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const auth = await verifyApprovedCrmAdmin(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const settings = normalizeNotificationSettings(body);
  const adminClient = createAdminClient();

  try {
    await saveNotificationSettings(adminClient, settings);
    return NextResponse.json({ settings });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to save settings.",
      },
      { status: 500 }
    );
  }
}
