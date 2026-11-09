export const LEAVE_DAY_PORTIONS = ["full", "am", "pm"] as const;
export type LeaveDayPortion = (typeof LEAVE_DAY_PORTIONS)[number];

export const LEAVE_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
] as const;
export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];

export const LEAVE_DECISIONS = ["approved", "rejected"] as const;
export type LeaveDecision = (typeof LEAVE_DECISIONS)[number];

export const LEAVE_REQUEST_EVENT_TYPES = [
  "submitted",
  "approved",
  "rejected",
  "cancelled",
  "comment",
] as const;
export type LeaveRequestEventType = (typeof LEAVE_REQUEST_EVENT_TYPES)[number];

export const STAFF_LEAVE_REGION = "england_wales" as const;

export const STAFF_LEAVE_FIRST_POLICY_YEAR = 2027;

export const COMPANY_CLOSURE_KINDS = ["compulsory_leave", "paid_gift"] as const;
export type CompanyClosureKind = (typeof COMPANY_CLOSURE_KINDS)[number];

export type CompanyClosureDate = {
  date: string;
  name: string;
  closureKind: CompanyClosureKind;
};

export type WorkingPatternWeek = {
  worksMon: boolean;
  worksTue: boolean;
  worksWed: boolean;
  worksThu: boolean;
  worksFri: boolean;
  worksSat: boolean;
  worksSun: boolean;
};

export type BankHolidayDate = {
  date: string;
  name: string;
};

export type LeaveBalanceSnapshot = {
  holidayYear: number;
  entitlementDays: number;
  adjustmentDays: number;
  usedApprovedDays: number;
  pendingDays: number;
  remainingDays: number;
  grossPolicyDays: number;
  reservedPoolDays: number;
};
