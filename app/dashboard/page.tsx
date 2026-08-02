import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { StaffAvatarDisplay } from "@/components/staff-avatar-display";
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
import {
  buildCustomerAppShellProps,
  loadCustomerPortalProfile,
  resolveCustomerDisplayName,
} from "@/lib/customer-shell-props";
import {
  getCustomerAccountStatusBadge,
  getCustomerAccountStatusDescription,
  getCustomerPortalStatusSubtitle,
} from "@/lib/customer-portal-status";
import { createClient } from "@/lib/supabase/server";
import { loadCustomerCompanyQuotes } from "@/lib/quote-request-link";
import {
  getFormalQuoteStatusLabel,
  mapCustomerQuoteStatusToBadge,
} from "@/lib/customer-quote-request";

export const dynamic = "force-dynamic";

const FORMAL_QUOTE_STATUSES = [
  "sent",
  "accepted",
  "declined",
  "expired",
  "superseded",
] as const;

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

  const profile = await loadCustomerPortalProfile(supabase, user.id);

  if (profile) {
    const roleRedirect = getDashboardRoleRedirect(profile);

    if (roleRedirect) {
      redirect(roleRedirect);
    }
  }

  const shellProps = await buildCustomerAppShellProps(supabase, user, profile);
  const fullName = resolveCustomerDisplayName(profile, user);
  const accountStatus = profile?.account_status ?? null;
  const accountBadge = accountStatus
    ? getCustomerAccountStatusBadge(accountStatus)
    : null;
  const statusSubtitle = getCustomerPortalStatusSubtitle(accountStatus);

  const [
    { count: formalQuotesCount, error: quotesError },
    { count: quoteRequestsCount, error: quoteRequestsError },
    { quotes: recentQuotes, loadError: recentQuotesError },
  ] = await Promise.all([
    supabase
      .from("quotes")
      .select("*", { count: "exact", head: true })
      .in("status", [...FORMAL_QUOTE_STATUSES]),
    supabase
      .from("quote_requests")
      .select("*", { count: "exact", head: true }),
    loadCustomerCompanyQuotes(supabase, { limit: 5 }),
  ]);

  const queryErrors = [
    quotesError ? `Quotes count: ${quotesError.message}` : null,
    quoteRequestsError
      ? `Quote requests count: ${quoteRequestsError.message}`
      : null,
    recentQuotesError ? `Recent quotes: ${recentQuotesError}` : null,
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
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <PageHeader
            eyebrow="Candid OS"
            title={`Welcome, ${fullName}`}
            description={statusSubtitle}
          />

          <StaffAvatarDisplay
            fullName={fullName}
            avatarUrl={shellProps.userAvatarUrl}
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
                ? getCustomerAccountStatusDescription(accountStatus)
                : "Unable to load account status."
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

        {recentQuotes.length > 0 ? (
          <Card className="portal-surface mt-8 overflow-hidden">
            <CardHeader className="border-b border-border">
              <CardTitle className="text-xl font-semibold">Recent quotes</CardTitle>
              <CardDescription>
                Formal quotes sent to your company.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {recentQuotes.map((quote) => (
                  <Link
                    key={quote.id}
                    href={`/quotes/${quote.id}`}
                    className="flex items-center justify-between gap-4 px-6 py-4 hover:bg-muted/35"
                  >
                    <div>
                      <p className="font-medium text-foreground">
                        Q-{quote.quoteNumber} · {quote.projectName}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Updated{" "}
                        {new Date(quote.updatedAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                    <StatusBadge
                      status={mapCustomerQuoteStatusToBadge(quote.status)}
                      label={getFormalQuoteStatusLabel(quote.status)}
                    />
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
