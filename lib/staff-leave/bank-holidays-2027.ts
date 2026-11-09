import type { BankHolidayDate } from "@/lib/staff-leave/types";

/**
 * England and Wales bank holidays for 2027 (verified against GOV.UK, Nov 2026).
 */
export const ENGLAND_WALES_BANK_HOLIDAYS_2027: BankHolidayDate[] = [
  { date: "2027-01-01", name: "New Year's Day" },
  { date: "2027-03-26", name: "Good Friday" },
  { date: "2027-03-29", name: "Easter Monday" },
  { date: "2027-05-03", name: "Early May bank holiday" },
  { date: "2027-05-31", name: "Spring bank holiday" },
  { date: "2027-08-30", name: "Summer bank holiday" },
  { date: "2027-12-27", name: "Christmas Day (substitute day)" },
  { date: "2027-12-28", name: "Boxing Day (substitute day)" },
];
