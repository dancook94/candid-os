import { unstable_noStore as noStore } from "next/cache";

import {
  AdminDashboardCrmMetrics,
  AdminDashboardCrmPanels,
  AdminDashboardCrmQuickActions,
  AdminDashboardRecentActivityPanel,
} from "@/components/admin/admin-dashboard-crm";
import { AppShell } from "@/components/app-shell";
import { ApproveCustomer } from "@/components/approve-customer";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ResendAccountReadyButton } from "@/components/resend-account-ready-button";
import { StatCard } from "@/components/stat-card";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchAdminJobMetrics } from "@/lib/admin-job-metrics";
import { fetchAdminQuoteMetrics } from "@/lib/admin-quote-metrics";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { fetchAdminDashboardCrm } from "@/lib/crm/admin-dashboard";
import { canApproveCustomers } from "@/lib/admin-auth";
import { fetchApprovedCustomerPortalProfiles } from "@/lib/admin/customer-portal-profile";
import { isCrmRole } from "@/lib/staff-roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  noStore();

  const supabase = await createClient();
  const isDevelopment = process.env.NODE_ENV === "development";
  const profile = await requireAdminPageAccess(supabase, "/admin");
  const showCrmOverview = isCrmRole(profile.user_role);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUserId = user?.id ?? "";

  const [quoteMetrics, jobMetrics, crmDashboard, { data: pendingUsers }, { data: companies }] =
    await Promise.all([
      fetchAdminQuoteMetrics(supabase),
      fetchAdminJobMetrics(supabase),
      showCrmOverview && currentUserId
        ? fetchAdminDashboardCrm(supabase, currentUserId)
        : Promise.resolve(null),
      supabase
        .from("profiles")
        .select(
          "id, full_name, requested_company_name, account_status, created_at"
        )
        .eq("account_status", "pending")
        .order("created_at", { ascending: true }),
      supabase
        .from("companies")
        .select("id, company_name")
        .eq("is_active", true)
        .order("company_name"),
    ]);

  const shellProps = await buildAdminAppShellProps(supabase, profile);
  const canApprovePendingCustomers = canApproveCustomers(profile);

  const approvedPortalCustomers =
    canApprovePendingCustomers
      ? await fetchApprovedCustomerPortalProfiles(createAdminClient())
      : { profiles: [], queryError: null };

  const dashboardErrors = [
    ...quoteMetrics.errors,
    ...jobMetrics.errors,
    ...(crmDashboard?.errors ?? []),
  ];

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          eyebrow="Administration"
          title="Admin dashboard"
          description="Manage customers, quotes, and CRM activity."
        />

        {isDevelopment && dashboardErrors.length > 0 ? (
          <Card className="portal-surface mb-6 border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <p className="text-sm font-medium text-red-800">
                Dashboard query errors
              </p>
              <ul className="mt-2 space-y-1 text-sm text-red-700">
                {dashboardErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <div className="mb-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Quotes sent"
            value={quoteMetrics.quotesSent.formattedValue}
            description="Awaiting customer decision"
            meta={quoteMetrics.quotesSent.formattedQuoteCount}
            href="/admin/quotes?status=sent"
          />

          <StatCard
            label="Quotes accepted"
            value={quoteMetrics.quotesAccepted.formattedValue}
            description="Confirmed quote value"
            meta={quoteMetrics.quotesAccepted.formattedQuoteCount}
            href="/admin/quotes?status=accepted"
          />

          <StatCard
            label="Artwork required"
            value={String(jobMetrics.artworkRequiredCount)}
            description="Accepted jobs awaiting customer artwork"
            meta={
              jobMetrics.schemaMissing
                ? "Jobs schema not deployed"
                : `${jobMetrics.artworkRequiredCount} job${jobMetrics.artworkRequiredCount === 1 ? "" : "s"}`
            }
            href="/admin/quotes?status=accepted"
          />

          <StatCard
            label="Quotes declined"
            value={quoteMetrics.quotesDeclined.formattedValue}
            description="Lost quote value"
            meta={quoteMetrics.quotesDeclined.formattedQuoteCount}
            href="/admin/quotes?status=declined"
            accentClassName="bg-red-400/45"
          />
        </div>

        {showCrmOverview && crmDashboard ? (
          <>
            <AdminDashboardCrmQuickActions />
            <AdminDashboardCrmMetrics data={crmDashboard} />
            <AdminDashboardRecentActivityPanel data={crmDashboard} />
            <AdminDashboardCrmPanels data={crmDashboard} />
          </>
        ) : null}

        <Card className="portal-surface overflow-hidden">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-lg font-semibold">
              Pending customer approvals
            </CardTitle>
          </CardHeader>

          <CardContent className="p-0">
            {!pendingUsers || pendingUsers.length === 0 ? (
              <EmptyState
                title="No pending approvals"
                description="There are no customers awaiting approval."
              />
            ) : (
              <div className="divide-y divide-border">
                {pendingUsers.map((pendingUser) => (
                  <div
                    key={pendingUser.id}
                    className="flex flex-col gap-4 px-6 py-5 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div>
                      <p className="font-medium text-foreground">
                        {pendingUser.full_name || "Unnamed customer"}
                      </p>

                      <p className="mt-1 text-sm text-muted-foreground">
                        {pendingUser.requested_company_name ||
                          "No company supplied"}
                      </p>
                    </div>

                    {canApprovePendingCustomers ? (
                      <ApproveCustomer
                        profileId={pendingUser.id}
                        companies={companies ?? []}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Only approved administrators can approve customers.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {canApprovePendingCustomers ? (
          <Card className="portal-surface mt-6 overflow-hidden">
            <CardHeader className="border-b border-border">
              <CardTitle className="text-lg font-semibold">
                Approved portal customers
              </CardTitle>
            </CardHeader>

            <CardContent className="p-0">
              {approvedPortalCustomers.queryError ? (
                <div className="px-6 py-5">
                  <p className="text-sm text-red-600">
                    {approvedPortalCustomers.queryError}
                  </p>
                </div>
              ) : approvedPortalCustomers.profiles.length === 0 ? (
                <EmptyState
                  title="No approved portal customers"
                  description="Approved self-registered customers will appear here."
                />
              ) : (
                <div className="divide-y divide-border">
                  {approvedPortalCustomers.profiles.map((customer) => (
                    <div
                      key={customer.id}
                      className="flex flex-col gap-4 px-6 py-5 lg:flex-row lg:items-center lg:justify-between"
                    >
                      <div>
                        <p className="font-medium text-foreground">
                          {customer.full_name || "Unnamed customer"}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {customer.company_name ||
                            customer.requested_company_name ||
                            "No company assigned"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Account status: {customer.account_status}
                        </p>
                      </div>

                      <ResendAccountReadyButton profileId={customer.id} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
