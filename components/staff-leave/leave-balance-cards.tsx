import { StatCard } from "@/components/stat-card";

type LeaveBalanceCardsProps = {
  entitlementDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
  reservedPoolDays: number;
  grossAllowanceDays: number;
};

export function LeaveBalanceCards({
  entitlementDays,
  usedDays,
  pendingDays,
  remainingDays,
  reservedPoolDays,
  grossAllowanceDays,
}: LeaveBalanceCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Bookable allowance" value={`${entitlementDays} days`} />
      <StatCard label="Approved leave used" value={`${usedDays} days`} />
      <StatCard label="Pending" value={`${pendingDays} days`} />
      <StatCard label="Remaining" value={`${remainingDays} days`} />
      <StatCard
        label="Reserved (bank holidays + compulsory closures)"
        value={`${reservedPoolDays} days`}
        className="sm:col-span-2"
      />
      <StatCard
        label="Gross policy allowance"
        value={`${grossAllowanceDays} days`}
        className="sm:col-span-2"
      />
    </div>
  );
}
