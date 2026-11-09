import { cronAuthorizationMatches } from "@/lib/gmail/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { processStaffLeaveCalendarSyncOutbox } from "@/lib/staff-leave/calendar-sync/process-outbox";

export async function handleStaffLeaveCalendarSyncCron(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret) {
    return Response.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }

  if (!cronAuthorizationMatches(request.headers.get("authorization"), cronSecret)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const result = await processStaffLeaveCalendarSyncOutbox(admin, { limit: 25 });

    return Response.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
