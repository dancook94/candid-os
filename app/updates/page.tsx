import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { ReportProblemDialog } from "@/components/updates/report-problem-dialog";
import { UpdatesFeed } from "@/components/updates/updates-feed";
import { YourReportsList } from "@/components/updates/your-reports-list";
import { Card, CardContent } from "@/components/ui/card";
import { fetchOwnProblemReports } from "@/lib/problem-reports/queries";
import { isAdminRole, isCrmRole } from "@/lib/staff-roles";
import {
  fetchVisibleProductUpdates,
  markVisibleProductUpdatesAsRead,
} from "@/lib/updates/queries";
import { requireUpdatesPageAccess } from "@/lib/updates/page-access";
import { buildAdminAppShellProps, buildCrmAppShellProps, buildStaffAppShellProps } from "@/lib/admin-shell-props";
import { buildCustomerAppShellProps } from "@/lib/customer-shell-props";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function UpdatesPage() {
  const supabase = await createClient();
  const { user, profile } = await requireUpdatesPageAccess(supabase);

  await markVisibleProductUpdatesAsRead(supabase, user.id, profile.user_role);

  const [updatesResult, reportsResult] = await Promise.all([
    fetchVisibleProductUpdates(supabase, { userRole: profile.user_role }),
    fetchOwnProblemReports(supabase, user.id),
  ]);

  const shellProps = isAdminRole(profile.user_role)
    ? await buildAdminAppShellProps(supabase, profile)
    : isCrmRole(profile.user_role)
      ? await buildCrmAppShellProps(supabase, profile)
      : profile.user_role === "customer"
        ? await buildCustomerAppShellProps(supabase, user, profile)
        : await buildStaffAppShellProps(supabase, profile);

  const schemaMissing = updatesResult.schemaMissing || reportsResult.schemaMissing;

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-4xl space-y-8">
        <PageHeader
          eyebrow="Candid OS"
          title="Updates"
          description="Latest improvements to Candid OS and a place to report problems while we refine the pilot."
          actions={<ReportProblemDialog sourcePath="/updates" />}
        />

        {schemaMissing ? (
          <Card className="rounded-2xl border-amber-200 bg-amber-50 shadow-sm ring-0">
            <CardContent className="p-6">
              <p className="text-sm font-medium text-amber-900">
                Updates are not available yet
              </p>
              <p className="mt-2 text-sm text-amber-800">
                The Updates module migration has not been applied to this environment yet.
              </p>
            </CardContent>
          </Card>
        ) : null}

        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-foreground">What&apos;s new</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Recent improvements relevant to your account.
            </p>
          </div>

          <UpdatesFeed updates={updatesResult.updates} />
        </section>

        <section>
          <YourReportsList reports={reportsResult.reports} />
        </section>
      </div>
    </AppShell>
  );
}
