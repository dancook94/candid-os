import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { AdminEntitlementForm } from "@/components/staff-leave/admin-entitlement-form";
import { AdminLeavePendingQueue } from "@/components/staff-leave/admin-leave-pending-queue";
import { LeaveRequestsHistory } from "@/components/staff-leave/leave-requests-history";
import { AdminOverlapWarnings } from "@/components/staff-leave/admin-overlap-warnings";
import { LeaveCalendar } from "@/components/staff-leave/leave-calendar";
import { LeaveLegend } from "@/components/staff-leave/leave-legend";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import {
  buildCalendarMarkers,
  monthDateRange,
} from "@/lib/staff-leave/build-calendar-markers";
import {
  buildLeaveCalendarHref,
  buildMonthGrid,
  formatMonthHeading,
  monthNavigation,
  londonTodayIso,
  parseYearMonth,
} from "@/lib/staff-leave/calendar";
import { findOverlappingLeaveWarnings } from "@/lib/staff-leave/overlap";
import {
  ADMIN_LEAVE_PATH,
  ADMIN_LEAVE_SICKNESS_PATH,
  requireAdminLeavePageAccess,
} from "@/lib/staff-leave/page-access";
import {
  fetchApprovedTeamLeave,
  fetchEntitlementAdjustment,
  fetchLeaveReferenceData,
  fetchLeaveRequestsForAdmin,
  fetchStaffLeaveBalances,
  fetchStaffMembersForLeaveAdmin,
  fetchWhoIsOffToday,
  leaveRequestProfileName,
} from "@/lib/staff-leave/queries";
import { STAFF_LEAVE_FIRST_POLICY_YEAR } from "@/lib/staff-leave/types";
import { formatIsoDateLocal } from "@/lib/staff-leave/working-days";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ year?: string; month?: string }>;
};

export default async function AdminLeavePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  await requireAdminLeavePageAccess(supabase, ADMIN_LEAVE_PATH);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: shellProfile } = await supabase
    .from("profiles")
    .select("full_name, user_role, account_status, avatar_storage_path")
    .eq("id", user!.id)
    .single();

  const holidayYear = STAFF_LEAVE_FIRST_POLICY_YEAR;
  const londonToday = londonTodayIso();
  const { year: calendarYear, month: calendarMonth } = parseYearMonth(params);
  const nav = monthNavigation(calendarYear, calendarMonth);
  const todayIso = formatIsoDateLocal(new Date());

  const [
    pendingResult,
    teamLeave,
    reference,
    membersResult,
    whoOff,
    allRequests,
  ] = await Promise.all([
    fetchLeaveRequestsForAdmin(supabase, { holidayYear, status: "pending" }),
    fetchApprovedTeamLeave(supabase, holidayYear),
    fetchLeaveReferenceData(supabase, calendarYear),
    fetchStaffMembersForLeaveAdmin(supabase),
    fetchWhoIsOffToday(supabase, todayIso),
    fetchLeaveRequestsForAdmin(supabase, { holidayYear }),
  ]);

  const members = membersResult.members;
  const memberIds = members.map((member) => member.id);
  const { rows: balanceRows } = await fetchStaffLeaveBalances(
    supabase,
    memberIds,
    holidayYear
  );

  const entitlementSeeds = await Promise.all(
    members.map(async (member) => {
      const { entitlement } = await fetchEntitlementAdjustment(
        supabase,
        member.id,
        holidayYear
      );
      return {
        profileId: member.id,
        adjustmentDays: Number(entitlement?.adjustment_days ?? 0),
        prorataStartDate: entitlement?.prorata_start_date ?? null,
      };
    })
  );

  const overlapInput = (allRequests.requests ?? []).map((request) => ({
    id: request.id,
    profileId: request.profile_id,
    fullName: leaveRequestProfileName(request.profiles),
    startDate: request.start_date,
    endDate: request.end_date,
    status: request.status,
  }));
  const overlapWarnings = findOverlappingLeaveWarnings(overlapInput, holidayYear);

  const teamSpans = teamLeave.requests.map((request) => {
    const profile = Array.isArray(request.profiles)
      ? request.profiles[0]
      : request.profiles;
    const name =
      profile && typeof profile === "object" && "full_name" in profile
        ? (profile as { full_name: string | null }).full_name
        : null;

    return {
      start_date: request.start_date,
      end_date: request.end_date,
      status: request.status,
      label: name ? `${name} (${request.status})` : `Team member (${request.status})`,
    };
  });

  const monthDates = monthDateRange(calendarYear, calendarMonth);
  const markers = buildCalendarMarkers({
    bankHolidays: reference.bankHolidays,
    closures: reference.closures,
    leaveSpans: teamSpans,
    monthDates,
  });
  const cells = buildMonthGrid(calendarYear, calendarMonth, markers);

  const shellProps = await buildAdminAppShellProps(supabase, shellProfile!);

  const prevHref = buildLeaveCalendarHref(ADMIN_LEAVE_PATH, nav.prev.year, nav.prev.month);
  const nextHref = buildLeaveCalendarHref(ADMIN_LEAVE_PATH, nav.next.year, nav.next.month);

  const balanceByProfile = new Map(
    balanceRows.map((row) => [row.profileId, row.balance])
  );

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <PageHeader
            eyebrow="Holiday & absence"
            title="Holiday management"
            description="Approve requests, review team availability, and manage allowances. Sickness is recorded on a separate management page."
          />
          <Link
            href={ADMIN_LEAVE_SICKNESS_PATH}
            className={buttonVariants({ variant: "outline" })}
          >
            Record sickness
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Pending approvals"
            value={String(pendingResult.requests.length)}
            href={ADMIN_LEAVE_PATH}
          />
          <StatCard
            label="Off today"
            value={String(whoOff.rows.length)}
            description={todayIso}
          />
          <StatCard
            label="Holiday year"
            value={String(holidayYear)}
            description="Bookable allowance excludes bank holidays and compulsory closures"
          />
        </div>

        <Card className="portal-surface overflow-hidden rounded-2xl shadow-sm ring-0">
          <CardHeader className="border-b border-border">
            <CardTitle>Pending holiday requests</CardTitle>
            <CardDescription>Approve or decline with an optional note.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <AdminLeavePendingQueue requests={pendingResult.requests} />
          </CardContent>
        </Card>

        <LeaveRequestsHistory
          title="Team holiday history"
          requests={allRequests.requests}
          emptyMessage="No holiday requests recorded for this year yet."
          cancelApiBase="/api/admin/leave/requests"
          showEmployeeName
          viewerProfileId={user!.id}
          isApprovedAdmin
          londonToday={londonToday}
        />

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="portal-surface rounded-2xl shadow-sm ring-0">
            <CardHeader className="border-b border-border">
              <CardTitle>Who is off today</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {whoOff.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No approved leave recorded for today.
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {whoOff.rows.map((row) => {
                    const profile = Array.isArray(row.profiles)
                      ? row.profiles[0]
                      : row.profiles;
                    const name =
                      profile && typeof profile === "object" && "full_name" in profile
                        ? (profile as { full_name: string | null }).full_name
                        : null;

                    return (
                      <li key={row.id}>
                        {name ?? "Team member"} · {row.day_portion}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="portal-surface rounded-2xl shadow-sm ring-0">
            <CardHeader className="border-b border-border">
              <CardTitle>Overlapping leave</CardTitle>
              <CardDescription>
                Days where two or more people are approved or pending.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <AdminOverlapWarnings warnings={overlapWarnings} />
            </CardContent>
          </Card>
        </div>

        <Card className="portal-surface rounded-2xl shadow-sm ring-0">
          <CardHeader className="border-b border-border">
            <CardTitle>Team calendar</CardTitle>
            <CardDescription>
              Bank holidays, compulsory Christmas closures, paid gift closure (does not
              reduce bookable allowance), and team leave.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <LeaveLegend />
            <LeaveCalendar
              basePath={ADMIN_LEAVE_PATH}
              year={calendarYear}
              month={calendarMonth}
              heading={formatMonthHeading(calendarYear, calendarMonth)}
              cells={cells}
              prevHref={prevHref}
              nextHref={nextHref}
            />
          </CardContent>
        </Card>

        <Card className="portal-surface overflow-hidden rounded-2xl shadow-sm ring-0">
          <CardHeader className="border-b border-border">
            <CardTitle>Employee balances</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Bookable</th>
                    <th className="px-4 py-3 font-medium">Used</th>
                    <th className="px-4 py-3 font-medium">Pending</th>
                    <th className="px-4 py-3 font-medium">Remaining</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {members.map((member) => {
                    const balance = balanceByProfile.get(member.id);
                    return (
                      <tr key={member.id}>
                        <td className="px-6 py-3 font-medium">
                          {member.full_name ?? "Team member"}
                        </td>
                        <td className="px-4 py-3">{balance?.entitlement_days ?? "—"}</td>
                        <td className="px-4 py-3">{balance?.approved_days ?? "—"}</td>
                        <td className="px-4 py-3">{balance?.pending_days ?? "—"}</td>
                        <td className="px-4 py-3">{balance?.remaining_days ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="portal-surface rounded-2xl shadow-sm ring-0">
          <CardHeader className="border-b border-border">
            <CardTitle>Annual allowance adjustments</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <AdminEntitlementForm
              members={members}
              holidayYear={holidayYear}
              seeds={entitlementSeeds}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
