import { createAdminClient } from "@/lib/supabase/admin";

import { processStaffLeaveNotificationOutbox } from "@/lib/staff-leave/notifications/process-outbox";

/** Best-effort delivery after a successful leave mutation; never throws to callers. */
export async function flushStaffLeaveNotifications(input?: {
  requestId?: string;
  limit?: number;
}) {
  try {
    const admin = createAdminClient();
    return await processStaffLeaveNotificationOutbox(admin, input);
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("[staff-leave-notifications] flush failed", error);
    }

    return {
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}
