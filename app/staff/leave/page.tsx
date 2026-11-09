import { AppShell } from "@/components/app-shell";
import { LeaveBalanceCards } from "@/components/staff-leave/leave-balance-cards";
import { LeaveCalendar } from "@/components/staff-leave/leave-calendar";
import { LeaveLegend } from "@/components/staff-leave/leave-legend";
import { LeaveRequestForm } from "@/components/staff-leave/leave-request-form";
import { LeaveRequestsTable } from "@/components/staff-leave/leave-requests-table";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buildAdminAppShellProps, buildStaffAppShellProps } from "@/lib/admin-shell-props";
import { isAdminRole } from "@/lib/staff-roles";
import {
  buildCalendarMarkers,
  monthDateRange,
} from "@/lib/staff-leave/build-calendar-markers";
import {
  buildLeaveCalendarHref,
  buildMonthGrid,
  formatMonthHeading,
  monthNavigation,
  parseYearMonth,
} from "@/lib/staff-leave/calendar";
import {
  STAFF_LEAVE_PATH,
  requireStaffLeavePageAccess,
} from "@/lib/staff-leave/page-access";
import {
  fetchApprovedTeamLeave,
  fetchLeaveBalance,
  fetchLeaveReferenceData,
  fetchOwnLeaveRequests,
} from "@/lib/staff-leave/queries";
import { STAFF_LEAVE_FIRST_POLICY_YEAR } from "@/lib/staff-leave/types";
import { buildLoginUrl } from "@/lib/auth-redirect";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ year?: string; month?: string }>;
};

export default async function StaffLeavePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl(STAFF_LEAVE_PATH));
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name, user_role, account_status, avatar_storage_path")
    .eq("id", user.id)
    .single();

  const staffProfile = requireStaffLeavePageAccess(profile, profileError, STAFF_LEAVE_PATH);

  const holidayYear = STAFF_LEAVE_FIRST_POLICY_YEAR;
  const { year: calendarYear, month: calendarMonth } = parseYearMonth(params);
  const nav = monthNavigation(calendarYear, calendarMonth);

  const [balanceResult, ownRequests, reference, teamLeave] = await Promise.all([
    fetchLeaveBalance(supabase, user.id, holidayYear),
    fetchOwnLeaveRequests(supabase, user.id, holidayYear),
    fetchLeaveReferenceData(supabase, calendarYear),
    fetchApprovedTeamLeave(supabase, holidayYear),
  ]);

  const balance = balanceResult.balance;

  const ownSpans = ownRequests.requests.map((request) => ({
    start_date: request.start_date,
    end_date: request.end_date,
    status: request.status,
    label: request.status === "pending" ? "Your pending leave" : "Your approved leave",
  }));

  const teamApprovedSpans = teamLeave.requests
    .filter((request) => request.profile_id !== user.id && request.status === "approved")
    .map((request) => {
      const teamProfile = Array.isArray(request.profiles)
        ? request.profiles[0]
        : request.profiles;
      const name =
        teamProfile && typeof teamProfile === "object" && "full_name" in teamProfile
          ? (teamProfile as { full_name: string | null }).full_name
          : null;

      return {
        start_date: request.start_date,
        end_date: request.end_date,
        status: request.status,
        label: name ? `${name} (approved)` : "Colleague (approved)",
      };
    });

  const monthDates = monthDateRange(calendarYear, calendarMonth);
  const markers = buildCalendarMarkers({
    bankHolidays: reference.bankHolidays,
    closures: reference.closures,
    leaveSpans: [...ownSpans, ...teamApprovedSpans],
    monthDates,
  });

  const cells = buildMonthGrid(calendarYear, calendarMonth, markers);

  const shellProps = isAdminRole(staffProfile.user_role)
    ? await buildAdminAppShellProps(supabase, {
        full_name: profile!.full_name,
        user_role: profile!.user_role,
        avatar_storage_path: profile!.avatar_storage_path,
      })
    : await buildStaffAppShellProps(supabase, {
        full_name: profile!.full_name,
        user_role: profile!.user_role,
        avatar_storage_path: profile!.avatar_storage_path,
      });

  const prevHref = buildLeaveCalendarHref(STAFF_LEAVE_PATH, nav.prev.year, nav.prev.month);
  const nextHref = buildLeaveCalendarHref(STAFF_LEAVE_PATH, nav.next.year, nav.next.month);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-6xl space-y-8">
        <PageHeader
          eyebrow="Holiday & absence"
          title="Your holiday"
          description="Request annual leave, track your balance, and view bank holidays and company closures. Sickness details are never shown here."
        />

        {balance ? (
          <LeaveBalanceCards
            entitlementDays={Number(balance.entitlement_days)}
            usedDays={Number(balance.approved_days)}
            pendingDays={Number(balance.pending_days)}
            remainingDays={Number(balance.remaining_days)}
            reservedPoolDays={Number(balance.reserved_pool_days)}
            grossAllowanceDays={Number(balance.gross_allowance_days)}
          />
        ) : null}

        <Card className="portal-surface rounded-2xl shadow-sm ring-0">
          <CardHeader className="border-b border-border">
            <CardTitle>Calendar</CardTitle>
            <CardDescription>
              Approved team leave, your requests, bank holidays, and closures. The
              paid gift on 31 December does not reduce your bookable allowance.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <LeaveLegend />
            <LeaveCalendar
              basePath={STAFF_LEAVE_PATH}
              year={calendarYear}
              month={calendarMonth}
              heading={formatMonthHeading(calendarYear, calendarMonth)}
              cells={cells}
              prevHref={prevHref}
              nextHref={nextHref}
            />
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="portal-surface rounded-2xl shadow-sm ring-0">
            <CardHeader className="border-b border-border">
              <CardTitle>Request holiday</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <LeaveRequestForm holidayYear={holidayYear} />
            </CardContent>
          </Card>

          <LeaveRequestsTable
            title="Your requests"
            requests={ownRequests.requests}
            emptyMessage="You have not submitted any leave requests for this holiday year yet."
          />
        </div>
      </div>
    </AppShell>
  );
}
