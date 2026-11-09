import { isTestAppEnvironment } from "@/lib/app-env";
import { cronAuthorizationMatches } from "@/lib/gmail/cron-auth";
import { staffLeaveCalendarControlledE2eAuthorized } from "@/lib/staff-leave/calendar-sync/controlled-e2e-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { processStaffLeaveCalendarSyncOutbox } from "@/lib/staff-leave/calendar-sync/process-outbox";

/**
 * Test-only: process exactly one calendar outbox row by id.
 */
export async function handleStaffLeaveControlledCalendarSyncCron(request: Request) {
  if (!isTestAppEnvironment()) {
    return Response.json({ error: "Controlled staff leave calendar sync is Test-only." }, { status: 404 });
  }

  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret) {
    return Response.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const authorized =
    cronAuthorizationMatches(request.headers.get("authorization"), cronSecret) ||
    staffLeaveCalendarControlledE2eAuthorized(request, serviceRoleKey);

  if (!authorized) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const outboxId = url.searchParams.get("outboxId")?.trim() || null;

  if (!outboxId) {
    return Response.json(
      { error: "Provide outboxId query parameter for scoped processing." },
      { status: 400 }
    );
  }

  try {
    const admin = createAdminClient();
    const result = await processStaffLeaveCalendarSyncOutbox(admin, { outboxId, limit: 1 });

    return Response.json({
      ok: true,
      scoped: true,
      scope: { outboxId },
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
