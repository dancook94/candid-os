import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { QuoteOpportunityCell } from "@/components/crm/link-quote-opportunity-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  ADMIN_QUOTE_OPPORTUNITY_LINK_OPTIONS,
  ADMIN_QUOTE_SORT_OPTIONS,
  ADMIN_QUOTE_STATUS_OPTIONS,
  fetchAdminQuotesList,
  hasActiveAdminQuotesFilters,
  parseAdminQuotesListFilters,
  type AdminQuotesListSearchParams,
} from "@/lib/admin-quotes-list";
import { formatAdminQuoteStatusLabel } from "@/lib/admin-quote-status";
import type { OpportunityStage } from "@/lib/crm/types";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { formatGbp, formatQuoteCount } from "@/lib/format-currency";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type BadgeStatus =
  | "pending"
  | "approved"
  | "disabled"
  | "draft"
  | "sent"
  | "accepted"
  | "declined";

const quoteStatusVariantMap: Record<string, BadgeStatus> = {
  draft: "draft",
  sent: "sent",
  accepted: "accepted",
  declined: "declined",
  expired: "disabled",
  superseded: "disabled",
};

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function mapQuoteStatusToBadge(value: string): BadgeStatus {
  return quoteStatusVariantMap[value.toLowerCase()] ?? "draft";
}

function formatSortLabel(sort: (typeof ADMIN_QUOTE_SORT_OPTIONS)[number]) {
  switch (sort) {
    case "newest":
      return "Newest first";
    case "oldest":
      return "Oldest first";
    case "highest":
      return "Highest value";
    case "lowest":
      return "Lowest value";
    case "project_asc":
      return "Project name A–Z";
    case "project_desc":
      return "Project name Z–A";
    default:
      return sort;
  }
}

function formatOpportunityLinkLabel(
  link: (typeof ADMIN_QUOTE_OPPORTUNITY_LINK_OPTIONS)[number]
) {
  switch (link) {
    case "all":
      return "All opportunity links";
    case "linked":
      return "Linked";
    case "not_linked":
      return "Not linked";
    default:
      return link;
  }
}

type AdminQuotesPageProps = {
  searchParams: Promise<AdminQuotesListSearchParams>;
};

export default async function AdminQuotesPage({
  searchParams,
}: AdminQuotesPageProps) {
  const rawSearchParams = await searchParams;
  const filters = parseAdminQuotesListFilters(rawSearchParams);
  const hasFilters = hasActiveAdminQuotesFilters(filters);

  const supabase = await createClient();
  const profile = await requireAdminPageAccess(supabase, "/admin/quotes");

  const [{ quotes, totalQuoteCount, filteredTotalValue, queryError }, { data: activeCompanies }] =
    await Promise.all([
      fetchAdminQuotesList(supabase, filters),
      supabase
        .from("companies")
        .select("id, company_name")
        .eq("is_active", true)
        .order("company_name"),
    ]);

  const isDevelopment = process.env.NODE_ENV === "development";
  const shellProps = await buildAdminAppShellProps(supabase, profile);

  const newQuoteButton = (
    <Link href="/admin/quotes/new">
      <Button>New quote</Button>
    </Link>
  );

  const pageDescription =
    filters.status === "declined"
      ? "Declined customer quotes."
      : "Create and manage customer quotes.";

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="Administration"
          title="Quotes"
          description={pageDescription}
          actions={newQuoteButton}
        />

        <Card className="portal-surface mb-6">
          <CardContent className="pt-6">
            <form
              method="get"
              className="grid gap-4 md:grid-cols-2 xl:grid-cols-7"
            >
              <div className="space-y-2 md:col-span-2 xl:col-span-2">
                <Label htmlFor="search">Search</Label>
                <Input
                  id="search"
                  name="search"
                  type="search"
                  placeholder="Search quotes, projects, or opportunities…"
                  defaultValue={filters.search}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  id="status"
                  name="status"
                  defaultValue={filters.status ?? ""}
                >
                  <option value="">All statuses</option>
                  {ADMIN_QUOTE_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {formatAdminQuoteStatusLabel(status)}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="company">Company</Label>
                <Select
                  id="company"
                  name="company"
                  defaultValue={filters.companyId ?? ""}
                >
                  <option value="">All companies</option>
                  {(activeCompanies ?? []).map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.company_name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="opportunity">Opportunity link</Label>
                <Select
                  id="opportunity"
                  name="opportunity"
                  defaultValue={filters.opportunityLink}
                >
                  {ADMIN_QUOTE_OPPORTUNITY_LINK_OPTIONS.map((link) => (
                    <option key={link} value={link}>
                      {formatOpportunityLinkLabel(link)}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sort">Sort</Label>
                <Select id="sort" name="sort" defaultValue={filters.sort}>
                  {ADMIN_QUOTE_SORT_OPTIONS.map((sort) => (
                    <option key={sort} value={sort}>
                      {formatSortLabel(sort)}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="from">Created from</Label>
                <Input
                  id="from"
                  name="from"
                  type="date"
                  defaultValue={filters.fromDate ?? ""}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="to">Created to</Label>
                <Input
                  id="to"
                  name="to"
                  type="date"
                  defaultValue={filters.toDate ?? ""}
                />
              </div>

              <div className="flex flex-wrap items-end gap-2 md:col-span-2 xl:col-span-7">
                <Button type="submit">Apply filters</Button>
                {hasFilters ? (
                  <Link href="/admin/quotes">
                    <Button type="button" variant="outline">
                      Clear filters
                    </Button>
                  </Link>
                ) : null}
              </div>
            </form>

            <p className="mt-4 text-xs text-muted-foreground">
              Date filters use each quote&apos;s created date.
            </p>
          </CardContent>
        </Card>

        {isDevelopment && queryError ? (
          <Card className="mb-6 rounded-2xl border-red-200 bg-red-50 shadow-sm ring-0">
            <CardContent className="p-6">
              <p className="text-sm font-medium text-red-800">
                Supabase query error
              </p>
              <p className="mt-2 text-sm text-red-700">{queryError}</p>
            </CardContent>
          </Card>
        ) : null}

        {totalQuoteCount === 0 ? (
          <EmptyState
            title="No quotes yet"
            description="Create your first draft quote to get started."
            action={newQuoteButton}
          />
        ) : quotes.length === 0 ? (
          <EmptyState
            title="No quotes match your filters."
            description="Try adjusting your search or filter selections."
            action={
              <Link href="/admin/quotes">
                <Button variant="outline">Clear filters</Button>
              </Link>
            }
          />
        ) : (
          <>
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <p className="text-sm font-medium text-foreground">
                {formatQuoteCount(quotes.length)}
              </p>
              <p className="text-sm text-muted-foreground">
                Filtered total: {formatGbp(filteredTotalValue)}
              </p>
            </div>

            <Card className="portal-surface overflow-hidden">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="portal-table">
                    <thead>
                      <tr>
                        <th>Quote</th>
                        <th>Project</th>
                        <th>Company</th>
                        <th>Version</th>
                        <th>Status</th>
                        <th>Opportunity</th>
                        <th>Total</th>
                        <th>Created</th>
                        <th>Sent</th>
                        <th className="text-right">Actions</th>
                      </tr>
                    </thead>

                    <tbody>
                      {quotes.map((quote) => (
                        <tr
                          key={quote.id}
                          className="cursor-pointer hover:bg-muted/35"
                        >
                          <td className="p-0">
                            <Link
                              href={`/admin/quotes/${quote.id}`}
                              className="block px-4 py-3.5 font-medium text-foreground"
                            >
                              Q-{quote.quote_number}
                            </Link>
                          </td>

                          <td className="p-0">
                            <Link
                              href={`/admin/quotes/${quote.id}`}
                              className="block px-4 py-3.5 text-foreground"
                            >
                              {quote.project_name}
                            </Link>
                          </td>

                          <td className="p-0">
                            <Link
                              href={`/admin/quotes/${quote.id}`}
                              className="block px-4 py-3.5 text-muted-foreground"
                            >
                              <span className="block">{quote.company_name}</span>
                              {quote.customer_name ? (
                                <span className="mt-0.5 block text-xs">
                                  {quote.customer_name}
                                  {quote.contact_email &&
                                  quote.contact_email !== quote.customer_name
                                    ? ` · ${quote.contact_email}`
                                    : null}
                                </span>
                              ) : null}
                            </Link>
                          </td>

                          <td className="p-0">
                            <Link
                              href={`/admin/quotes/${quote.id}`}
                              className="block px-4 py-3.5 text-muted-foreground"
                            >
                              v{quote.current_version}
                            </Link>
                          </td>

                          <td className="p-0">
                            <Link
                              href={`/admin/quotes/${quote.id}`}
                              className="block px-4 py-3.5"
                            >
                              <StatusBadge
                                status={mapQuoteStatusToBadge(quote.status)}
                                label={formatAdminQuoteStatusLabel(quote.status)}
                              />
                            </Link>
                          </td>

                          <td className="p-0">
                            <QuoteOpportunityCell
                              quoteId={quote.id}
                              opportunityId={quote.opportunity_id}
                              opportunityTitle={quote.opportunity_title}
                              opportunityStage={
                                quote.opportunity_stage as OpportunityStage | null
                              }
                            />
                          </td>

                          <td className="p-0">
                            <Link
                              href={`/admin/quotes/${quote.id}`}
                              className="block px-4 py-3.5 text-muted-foreground"
                            >
                              {formatGbp(quote.current_version_total)}
                            </Link>
                          </td>

                          <td className="p-0">
                            <Link
                              href={`/admin/quotes/${quote.id}`}
                              className="block px-4 py-3.5 text-muted-foreground"
                            >
                              {formatDate(quote.created_at)}
                            </Link>
                          </td>

                          <td className="p-0">
                            <Link
                              href={`/admin/quotes/${quote.id}`}
                              className="block px-4 py-3.5 text-muted-foreground"
                            >
                              {quote.sent_at ? formatDate(quote.sent_at) : "—"}
                            </Link>
                          </td>

                          <td className="p-0 text-right">
                            <Link
                              href={`/admin/quotes/${quote.id}`}
                              className="inline-flex px-4 py-3.5"
                            >
                              <Button variant="outline" size="sm">
                                View quote
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
