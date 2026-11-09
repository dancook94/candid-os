import { isTestAppEnvironment } from "@/lib/app-env";
import { cronAuthorizationMatches } from "@/lib/gmail/cron-auth";
import { staffLeaveControlledE2eAuthorized } from "@/lib/staff-leave/notifications/controlled-e2e-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { processStaffLeaveNotificationOutbox } from "@/lib/staff-leave/notifications/process-outbox";

/**
 * Test-only: process exactly one outbox row by id. Never falls back to unscoped batch processing.
 *
 * Concurrency: the scheduled cron (`/api/cron/staff-leave-notifications`) runs independently and may
 * process other queued rows in the same window. Scoped success/failure reflects only the targeted outbox id.
 */
export async function handleStaffLeaveControlledNotificationsCron(request: Request) {
  if (!isTestAppEnvironment()) {
    return Response.json({ error: "Controlled staff leave notifications are Test-only." }, { status: 404 });
  }

  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret) {
    return Response.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const authorized =
    cronAuthorizationMatches(request.headers.get("authorization"), cronSecret) ||
    staffLeaveControlledE2eAuthorized(request, serviceRoleKey);

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
    const result = await processStaffLeaveNotificationOutbox(admin, {
      outboxId,
      limit: 1,
    });

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
