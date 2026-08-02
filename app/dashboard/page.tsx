import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { CompanyLogoDisplay } from "@/components/company-logo-display";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getDashboardRoleRedirect } from "@/lib/auth-redirect";
import { loadCustomerCompanyBranding } from "@/lib/customer-company-branding";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const FORMAL_QUOTE_STATUSES = [
  "sent",
  "accepted",
  "declined",
  "expired",
  "superseded",
] as const;

type AccountBadgeStatus = "pending" | "approved" | "disabled";

function formatAccountStatusLabel(accountStatus: string) {
  return accountStatus.charAt(0).toUpperCase() + accountStatus.slice(1);
}

function mapAccountStatusToBadge(
  accountStatus: string
): { status: AccountBadgeStatus; label: string } {
  if (accountStatus === "approved") {
    return { status: "approved", label: "Approved" };
  }

  if (accountStatus === "pending") {
    return { status: "pending", label: "Pending" };
  }

  if (accountStatus === "disabled") {
    return { status: "disabled", label: "Disabled" };
  }

  return { status: "pending", label: formatAccountStatusLabel(accountStatus) };
}

function accountStatusDescription(accountStatus: string) {
  if (accountStatus === "approved") {
    return "Your company access is active.";
  }

  if (accountStatus === "disabled") {
    return "Your account access is currently disabled.";
  }

  return "Candid will confirm your company access.";
}

export default async function DashboardPage() {
  noStore();

  const supabase = await createClient();
  const isDevelopment = process.env.NODE_ENV === "development";

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name, company_id, account_status, user_role")
    .eq("id", user.id)
    .single();

  if (profileError) {
    if (isDevelopment) {
      console.error("[dashboard] profile load failed:", profileError.message);
    }
  } else {
    const roleRedirect = getDashboardRoleRedirect(profile);

    if (roleRedirect) {
      redirect(roleRedirect);
    }
  }

  const fallbackCompanyName =
    user.user_metadata?.company_name || "Company awaiting approval";

  const [
    { count: formalQuotesCount, error: quotesError },
    { count: quoteRequestsCount, error: quoteRequestsError },
    companyBranding,
  ] = await Promise.all([
    supabase
      .from("quotes")
      .select("*", { count: "exact", head: true })
      .in("status", [...FORMAL_QUOTE_STATUSES]),
    supabase
      .from("quote_requests")
      .select("*", { count: "exact", head: true }),
    profile?.company_id
      ? loadCustomerCompanyBranding(
          supabase,
          profile.company_id,
          fallbackCompanyName
        )
      : Promise.resolve({
          companyName: fallbackCompanyName,
          companyLogoUrl: null,
        }),
  ]);

  const fullName =
    profile?.full_name ||
    user.user_metadata?.full_name ||
    user.email ||
    "Customer";

  const companyName = companyBranding.companyName;
  const companyLogoUrl = companyBranding.companyLogoUrl;

  const accountStatus = profile?.account_status ?? null;
  const accountBadge = accountStatus
    ? mapAccountStatusToBadge(accountStatus)
    : null;

  const queryErrors = [
    profileError ? `Profile: ${profileError.message}` : null,
    quotesError ? `Quotes count: ${quotesError.message}` : null,
    quoteRequestsError
      ? `Quote requests count: ${quoteRequestsError.message}`
      : null,
  ].filter(Boolean) as string[];

  const quotesValue =
    quotesError && !isDevelopment
      ? "—"
      : String(formalQuotesCount ?? 0);

  const quoteRequestsValue =
    quoteRequestsError && !isDevelopment
      ? "—"
      : String(quoteRequestsCount ?? 0);

  return (
    <AppShell
      userRole="customer"
      userName={fullName}
      companyName={companyName}
      companyLogoUrl={companyLogoUrl}
    >
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <PageHeader
            eyebrow="Candid OS"
            title={`Welcome, ${fullName}`}
            description={companyName}
          />

          <CompanyLogoDisplay
            companyName={companyName}
            logoUrl={companyLogoUrl}
            size="lg"
          />
        </div>

        {isDevelopment && queryErrors.length > 0 ? (
          <Card className="portal-surface mb-6 border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <p className="text-sm font-medium text-red-800">
                Dashboard query errors
              </p>
              <ul className="mt-2 space-y-1 text-sm text-red-700">
                {queryErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-5 md:grid-cols-3">
          <StatCard
            label="Quotes"
            value={quotesValue}
            description="Formal quotes sent to your company"
          />

          <StatCard
            label="Quote requests"
            value={quoteRequestsValue}
            description="Quote requests submitted by your company"
          />

          <StatCard
            label="Account status"
            value={
              accountBadge ? (
                <StatusBadge
                  status={accountBadge.status}
                  label={accountBadge.label}
                />
              ) : (
                "—"
              )
            }
            description={
              accountStatus
                ? accountStatusDescription(accountStatus)
                : profileError
                  ? "Unable to load account status."
                  : "Profile not found."
            }
          />
        </div>

        <Card className="portal-surface mt-8">
          <CardHeader>
            <CardTitle className="text-xl font-semibold">
              Request a quote
            </CardTitle>

            <CardDescription>
              Submit a new quote request with your project and delivery details.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <Link href="/quotes/request">
              <Button>Request a quote</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
