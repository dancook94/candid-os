import { NextResponse } from "next/server";

import { verifyApprovedCrmAdmin } from "@/lib/crm-auth";
import { retryFailedNotification } from "@/lib/notifications/send-notification";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const auth = await verifyApprovedCrmAdmin(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const adminClient = createAdminClient();

  try {
    const result = await retryFailedNotification(adminClient, id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Retry failed." },
      { status: 400 }
    );
  }
}
