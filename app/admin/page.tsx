import { unstable_noStore as noStore } from "next/cache";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ApproveCustomer } from "@/components/approve-customer";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchAdminQuoteMetrics } from "@/lib/admin-quote-metrics";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { buildLoginUrl } from "@/lib/auth-redirect";
import { isCandidAdminRole, resolveAdminAccessDeniedPath } from "@/lib/staff-roles";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  noStore();

  const supabase = await createClient();
  const isDevelopment = process.env.NODE_ENV === "development";

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(buildLoginUrl("/admin"));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, account_status, user_role, avatar_storage_path")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    profile.account_status !== "approved" ||
    !isCandidAdminRole(profile.user_role)
  ) {
    redirect(resolveAdminAccessDeniedPath(profile?.user_role));
  }

  const [quoteMetrics, { data: pendingUsers }, { data: companies }] =
    await Promise.all([
      fetchAdminQuoteMetrics(supabase),
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

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-6xl">
        <PageHeader
          eyebrow="Administration"
          title="Admin dashboard"
          description="Manage customer registrations and portal access."
        />

        {isDevelopment && quoteMetrics.errors.length > 0 ? (
          <Card className="portal-surface mb-6 border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <p className="text-sm font-medium text-red-800">
                Dashboard quote metrics query errors
              </p>
              <ul className="mt-2 space-y-1 text-sm text-red-700">
                {quoteMetrics.errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <div className="mb-8 grid gap-5 md:grid-cols-3">
          <StatCard
            label="Quotes sent"
            value={quoteMetrics.quotesSent.formattedValue}
            description="Awaiting customer decision"
            meta={quoteMetrics.quotesSent.formattedQuoteCount}
          />

          <StatCard
            label="Quotes accepted"
            value={quoteMetrics.quotesAccepted.formattedValue}
            description="Confirmed quote value"
            meta={quoteMetrics.quotesAccepted.formattedQuoteCount}
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

                    <ApproveCustomer
                      profileId={pendingUser.id}
                      companies={companies ?? []}
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
