export const COMPLETION_CHECKLIST = [
  "Site left safe and clean/tidy",
  "Installation photos recorded",
] as const;

export const COMPLETION_CHECKLIST_KEYS = [
  "site_left_safe_and_tidy",
  "installation_photos_recorded",
] as const;

export type CompletionChecklistRecord = {
  siteLeftSafeAndTidy: boolean;
  installationPhotosRecorded: boolean;
};

export function completionChecklistPayload(checks: readonly boolean[]) {
  return {
    site_left_safe_and_tidy: checks[0] === true,
    installation_photos_recorded: checks[1] === true,
  };
}

export function readCompletionChecklist(value: unknown): CompletionChecklistRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const siteLeftSafeAndTidy = record.site_left_safe_and_tidy === true;
  const installationPhotosRecorded = record.installation_photos_recorded === true;
  if (!siteLeftSafeAndTidy && !installationPhotosRecorded) {
    return null;
  }

  return { siteLeftSafeAndTidy, installationPhotosRecorded };
}

export const CUSTOMER_ATTENDANCE_OPTIONS = [
  { value: "present", label: "Customer present" },
  { value: "absent", label: "Customer not present" },
  { value: "declined", label: "Customer declined to sign" },
] as const;

export type CustomerAttendance = (typeof CUSTOMER_ATTENDANCE_OPTIONS)[number]["value"];

export function completionIssues(input: {
  checklist: readonly boolean[];
  attendance: CustomerAttendance | "";
  customerName: string;
  signaturePresent: boolean;
  declineReason: string;
  outstandingSnags: number;
}) {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (input.checklist.length !== COMPLETION_CHECKLIST.length || input.checklist.some((item) => !item)) {
    errors.push("Complete the checklist before sign-off.");
  }

  if (!input.attendance) {
    errors.push("Record whether the customer was present.");
  }

  if (input.attendance === "present") {
    if (!input.customerName.trim()) {
      errors.push("Enter the customer name.");
    }
    if (!input.signaturePresent) {
      errors.push("A handwritten signature is required when the customer is present.");
    }
  }

  if (input.attendance === "declined" && input.declineReason.trim().length === 0) {
    errors.push("Explain why the customer declined to sign.");
  }

  if (input.outstandingSnags > 0) {
    warnings.push(
      `${input.outstandingSnags} outstanding snag${input.outstandingSnags === 1 ? "" : "s"} remain.`
    );
  }

  return {
    errors,
    warnings,
    canSave: errors.length === 0,
  };
}
