import { getCommunicationConfig } from "@/lib/communications/config";
import { isValidEmail } from "@/lib/notifications/recipient-resolution";
import { isTestAppEnvironment } from "@/lib/app-env";

export type StaffLeaveDeliveryGate =
  | {
      allowed: true;
      mode: "test" | "live" | "suppressed";
      /** When set, all staff leave emails must use this recipient (Test safe inbox). */
      recipientOverride: string | null;
    }
  | {
      allowed: false;
      reason:
        | "staff_leave_test_requires_communication_mode_test"
        | "staff_leave_test_missing_recipient"
        | "communications_suppressed";
    };

/**
 * Fail closed on Test: requires explicit test mode + configured safe inbox.
 * Bypasses internal-domain passthrough by supplying recipientOverride on Test.
 */
export function getStaffLeaveDeliveryGate(): StaffLeaveDeliveryGate {
  const config = getCommunicationConfig();

  if (config.mode === "suppressed") {
    return { allowed: false, reason: "communications_suppressed" };
  }

  if (isTestAppEnvironment() || config.mode === "test") {
    if (config.mode !== "test") {
      return { allowed: false, reason: "staff_leave_test_requires_communication_mode_test" };
    }

    const testRecipient = config.testRecipient?.trim().toLowerCase() ?? "";

    if (!testRecipient || !isValidEmail(testRecipient)) {
      return { allowed: false, reason: "staff_leave_test_missing_recipient" };
    }

    return {
      allowed: true,
      mode: "test",
      recipientOverride: testRecipient,
    };
  }

  return {
    allowed: true,
    mode: config.mode,
    recipientOverride: null,
  };
}
