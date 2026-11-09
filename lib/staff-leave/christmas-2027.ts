import type { BankHolidayDate, CompanyClosureDate } from "@/lib/staff-leave/types";

/**
 * Christmas 2027 policy (Candid Creative Test).
 * Three compulsory days (24, 29, 30 Dec) deduct from the 28-day entitlement pool.
 * 31 Dec is employer-gifted paid closure and does not reduce bookable allowance.
 * 27–28 Dec are substitute bank holidays (seeded in staff_bank_holidays).
 * 3 Jan 2028 substitute New Year's Day is in the 2028 holiday year.
 */
export const CHRISTMAS_2027_COMPULSORY_CLOSURES: CompanyClosureDate[] = [
  {
    date: "2027-12-24",
    name: "Christmas closure — compulsory annual leave",
    closureKind: "compulsory_leave",
  },
  {
    date: "2027-12-29",
    name: "Christmas closure — compulsory annual leave",
    closureKind: "compulsory_leave",
  },
  {
    date: "2027-12-30",
    name: "Christmas closure — compulsory annual leave",
    closureKind: "compulsory_leave",
  },
];

export const CHRISTMAS_2027_GIFTED_CLOSURES: CompanyClosureDate[] = [
  {
    date: "2027-12-31",
    name: "New Year's Eve — paid company closure (gifted)",
    closureKind: "paid_gift",
  },
];

export const CHRISTMAS_2027_ALL_CLOSURES: CompanyClosureDate[] = [
  ...CHRISTMAS_2027_COMPULSORY_CLOSURES,
  ...CHRISTMAS_2027_GIFTED_CLOSURES,
];

export const BANK_HOLIDAY_2028_NEW_YEAR_SUBSTITUTE: BankHolidayDate = {
  date: "2028-01-03",
  name: "New Year's Day (substitute day)",
};
