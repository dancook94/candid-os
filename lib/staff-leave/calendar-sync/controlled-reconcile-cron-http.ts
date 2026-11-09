import { isTestAppEnvironment } from "@/lib/app-env";
import { cronAuthorizationMatches } from "@/lib/gmail/cron-auth";
import { staffLeaveCalendarControlledE2eAuthorized } from "@/lib/staff-leave/calendar-sync/controlled-e2e-auth";
import {
  enqueueStaffLeaveCalendarReconciliation,
  scanStaffLeaveCalendarReconciliation,
} from "@/lib/staff-leave/calendar-sync/reconcile";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Test-only: reconciliation scan/enqueue for automated E2E (service role, not admin UI session).
 */
export async function handleStaffLeaveControlledCalendarReconcileCron(request: Request) {
  if (!isTestAppEnvironment()) {
    return Response.json({ error: "Controlled calendar reconcile is Test-only." }, { status: 404 });
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
  const includeGoogleRefresh =
    url.searchParams.get("includeGoogleRefresh") === "1" ||
    url.searchParams.get("includeGoogleRefresh") === "true";
  const dryRun =
    url.searchParams.get("dryRun") !== "0" && url.searchParams.get("enqueue") !== "1";
  const enqueue = url.searchParams.get("enqueue") === "1";

  try {
    const admin = createAdminClient();
    const scan = await scanStaffLeaveCalendarReconciliation(admin, {
      targetGoogleProvider: includeGoogleRefresh,
    });

    const enqueueResult = enqueue
      ? await enqueueStaffLeaveCalendarReconciliation(admin, {
          dryRun: false,
          includeGoogleRefresh,
        })
      : {
          dryRun: true,
          enqueued: 0,
          skipped: scan.findings.length,
          findings: scan.findings,
        };

    return Response.json({
      ok: true,
      scoped: true,
      dryRun: dryRun && !enqueue,
      includeGoogleRefresh,
      scan,
      enqueue: enqueueResult,
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
