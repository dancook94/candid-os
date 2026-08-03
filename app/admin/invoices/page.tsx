import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  ADMIN_INVOICE_VIEW_OPTIONS,
  fetchAdminInvoicesList,
  hasActiveAdminInvoicesFilters,
  parseAdminInvoicesListFilters,
  type AdminInvoicesListSearchParams,
} from "@/lib/admin-invoices-list";
import { buildCrmAppShellProps } from "@/lib/admin-shell-props";
import { requireCrmPageAccess } from "@/lib/crm-page-access";
import { formatGbp } from "@/lib/format-currency";
import {
  INVOICE_DISPLAY_STATUS_LABELS,
  type InvoiceDisplayStatus,
} from "@/lib/invoice/display-status";
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

const invoiceStatusVariantMap: Record<InvoiceDisplayStatus, BadgeStatus> = {
  draft: "draft",
  needs_pricing: "pending",
  ready_for_review: "sent",
  ready_for_xero: "approved",
  pushed_to_xero: "accepted",
  invoiced: "accepted",
  cancelled: "disabled",
};

function formatDate(dateString: string | null) {
  if (!dateString) {
    return "—";
  }

  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatViewLabel(view: (typeof ADMIN_INVOICE_VIEW_OPTIONS)[number]) {
  switch (view) {
    case "needs_attention":
      return "Needs attention";
    case "drafts":
      return "Drafts";
    case "approved":
      return "Approved";
    case "sent_to_xero":
      return "Sent to Xero";
    case "all":
      return "All";
    default:
      return view;
  }
}

type AdminInvoicesPageProps = {
  searchParams: Promise<AdminInvoicesListSearchParams>;
};

export default async function AdminInvoicesPage({
  searchParams,
}: AdminInvoicesPageProps) {
  const rawSearchParams = await searchParams;
  const filters = parseAdminInvoicesListFilters(rawSearchParams);
  const hasFilters = hasActiveAdminInvoicesFilters(filters);

  const supabase = await createClient();
  const profile = await requireCrmPageAccess(supabase, "/admin/invoices");
  const shellProps = await buildCrmAppShellProps(supabase, profile);

  const [{ invoices, metrics, schemaMissing, queryError }, { data: companies }] =
    await Promise.all([
      fetchAdminInvoicesList(supabase, filters),
      supabase
        .from("companies")
        .select("id, company_name")
        .eq("is_active", true)
        .order("company_name"),
    ]);

  const isDevelopment = process.env.NODE_ENV === "development";

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="Commercial"
          title="Invoices"
          description="Invoice drafts awaiting pricing, review, and Xero preparation."
        />

        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="portal-surface">
            <CardContent className="pt-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Needs pricing
              </p>
              <p className="mt-2 text-2xl font-semibold">{metrics.needsPricingCount}</p>
            </CardContent>
          </Card>
          <Card className="portal-surface">
            <CardContent className="pt-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Ready for review
              </p>
              <p className="mt-2 text-2xl font-semibold">{metrics.readyForReviewCount}</p>
            </CardContent>
          </Card>
          <Card className="portal-surface">
            <CardContent className="pt-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Ready for Xero
              </p>
              <p className="mt-2 text-2xl font-semibold">{metrics.readyForXeroCount}</p>
            </CardContent>
          </Card>
          <Card className="portal-surface">
            <CardContent className="pt-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Total draft value
              </p>
              <p className="mt-2 text-2xl font-semibold">{formatGbp(metrics.totalDraftValue)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Excludes cancelled drafts</p>
            </CardContent>
          </Card>
        </div>

        <Card className="portal-surface mb-6">
          <CardContent className="pt-6">
            <form method="get" className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {ADMIN_INVOICE_VIEW_OPTIONS.map((view) => (
                  <Button
                    key={view}
                    type="submit"
                    name="view"
                    value={view}
                    variant={filters.view === view ? "default" : "outline"}
                    size="sm"
                  >
                    {formatViewLabel(view)}
                  </Button>
                ))}
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="search">Search</Label>
                  <Input
                    id="search"
                    name="search"
                    defaultValue={filters.search}
                    placeholder="Job, quote, company, PO, Xero number"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company">Company</Label>
                  <Select id="company" name="company" defaultValue={filters.companyId ?? ""}>
                    <option value="">All companies</option>
                    {(companies ?? []).map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.company_name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status">Draft status</Label>
                  <Select id="status" name="status" defaultValue={filters.displayStatus ?? ""}>
                    <option value="">All statuses</option>
                    {Object.entries(INVOICE_DISPLAY_STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="from">Updated from</Label>
                  <Input id="from" name="from" type="date" defaultValue={filters.fromDate ?? ""} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="to">Updated to</Label>
                  <Input id="to" name="to" type="date" defaultValue={filters.toDate ?? ""} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="approved">Approval</Label>
                  <Select
                    id="approved"
                    name="approved"
                    defaultValue={filters.approvedFilter}
                  >
                    <option value="all">All</option>
                    <option value="approved">Approved only</option>
                    <option value="not_approved">Not approved</option>
                  </Select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="needs_pricing"
                    value="1"
                    defaultChecked={filters.needsPricingOnly}
                  />
                  Needs pricing only
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="hidden" name="production_complete" value="" />
                  <Select
                    name="production_complete"
                    defaultValue={filters.productionComplete}
                    className="w-48"
                  >
                    <option value="all">All production states</option>
                    <option value="complete">Production complete</option>
                    <option value="not_complete">Production not complete</option>
                  </Select>
                </label>
                <Button type="submit">Apply filters</Button>
                {hasFilters ? (
                  <Link href="/admin/invoices">
                    <Button type="button" variant="outline">
                      Clear
                    </Button>
                  </Link>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>

        {queryError ? (
          <Card className="portal-surface mb-6 border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <p className="text-sm font-medium text-red-800">Unable to load invoice drafts</p>
              <p className="mt-1 text-sm text-red-700">{queryError}</p>
              {isDevelopment ? (
                <p className="mt-2 text-xs text-red-600">
                  Check Supabase logs and confirm invoice migrations are applied.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {schemaMissing ? (
          <Card className="portal-surface mb-6">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                Invoice draft tables are not configured yet. Apply{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  supabase/migrations/20260803200000_production_manifest_invoice_foundation.sql
                </code>{" "}
                and{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  supabase/migrations/20260803210000_job_invoice_items_title_and_manual_edit.sql
                </code>
                .
              </p>
            </CardContent>
          </Card>
        ) : null}

        {invoices.length === 0 && !queryError && !schemaMissing ? (
          <EmptyState
            title="No invoice drafts match these filters"
            description="Invoice drafts appear here when jobs enter invoice review or production completes."
          />
        ) : invoices.length > 0 ? (
          <Card className="portal-surface overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Company</th>
                      <th>Project</th>
                      <th>Quote</th>
                      <th>PO</th>
                      <th>Status</th>
                      <th>Original quote</th>
                      <th>Cancellations</th>
                      <th>Additions</th>
                      <th>Final total</th>
                      <th>Unpriced</th>
                      <th>Production complete</th>
                      <th>Approved</th>
                      <th>Updated</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice) => (
                      <tr key={invoice.id} className="hover:bg-muted/35">
                        <td className="p-4 font-medium">
                          <Link
                            href={`/admin/jobs/${invoice.jobId}/invoice`}
                            className="underline-offset-4 hover:underline"
                          >
                            {invoice.jobReference}
                          </Link>
                        </td>
                        <td className="p-4 text-muted-foreground">{invoice.companyName}</td>
                        <td className="p-4 text-muted-foreground">{invoice.projectName}</td>
                        <td className="p-4 text-muted-foreground">
                          {invoice.quoteId ? (
                            <Link
                              href={`/admin/quotes/${invoice.quoteId}`}
                              className="underline-offset-4 hover:underline"
                            >
                              {invoice.quoteNumber ? `Q-${invoice.quoteNumber}` : "Quote"}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-4 text-muted-foreground">
                          {invoice.purchaseOrderNumber ?? "—"}
                        </td>
                        <td className="p-4">
                          <StatusBadge
                            status={invoiceStatusVariantMap[invoice.displayStatus]}
                            label={INVOICE_DISPLAY_STATUS_LABELS[invoice.displayStatus]}
                          />
                          {invoice.unpricedCount > 0 ? (
                            <p className="mt-1 text-xs text-amber-700">
                              {invoice.unpricedCount} need pricing
                            </p>
                          ) : null}
                        </td>
                        <td className="p-4 text-muted-foreground">
                          {formatGbp(invoice.originalQuoteTotal)}
                        </td>
                        <td className="p-4 text-muted-foreground">
                          {invoice.cancellationsTotal > 0
                            ? `-${formatGbp(invoice.cancellationsTotal)}`
                            : formatGbp(0)}
                        </td>
                        <td className="p-4 text-muted-foreground">
                          {formatGbp(invoice.additionsTotal)}
                        </td>
                        <td className="p-4 font-medium">{formatGbp(invoice.total)}</td>
                        <td className="p-4 text-muted-foreground">{invoice.unpricedCount}</td>
                        <td className="p-4 text-muted-foreground">
                          {formatDate(invoice.productionCompletedAt)}
                        </td>
                        <td className="p-4 text-muted-foreground">
                          {formatDate(invoice.approvedAt)}
                        </td>
                        <td className="p-4 text-muted-foreground">
                          {formatDate(invoice.updatedAt)}
                        </td>
                        <td className="p-4">
                          <div className="flex flex-wrap gap-2">
                            <Link href={`/admin/jobs/${invoice.jobId}/invoice`}>
                              <Button type="button" size="sm" variant="outline">
                                Review
                              </Button>
                            </Link>
                            <Link href={`/admin/jobs/${invoice.jobId}`}>
                              <Button type="button" size="sm" variant="ghost">
                                Job
                              </Button>
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
