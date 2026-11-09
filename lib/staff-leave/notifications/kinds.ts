export const STAFF_LEAVE_OUTBOX_KINDS = [
  "management_annual_submitted",
  "management_additional_paid_submitted",
  "employee_approved",
  "employee_declined",
  "management_approved_cancelled",
  "employee_additional_paid_granted",
] as const;

export type StaffLeaveOutboxKind = (typeof STAFF_LEAVE_OUTBOX_KINDS)[number];

export function isStaffLeaveOutboxKind(value: string): value is StaffLeaveOutboxKind {
  return (STAFF_LEAVE_OUTBOX_KINDS as readonly string[]).includes(value);
}
