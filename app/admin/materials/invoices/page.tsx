import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { InvoiceUploadForm } from "@/components/materials/invoice-upload-form";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { formatGbp } from "@/lib/materials/invoices/money";
import { PROCESSING_STATUS_LABELS } from "@/lib/materials/invoices/model";
import {
  emptyLineCounts,
  loadInvoiceList,
  type InvoiceListItem,
} from "@/lib/materials/invoices/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type InvoicesPageProps = {
  searchParams: Promise<{ view?: string }>;
};

const VIEWS = [
  { id: "needs_review", label: "Needs review" },
  { id: "price_change", label: "Price changes" },
  { id: "unmatched", label: "Unmatched" },
  { id: "extraction_error", label: "Extraction errors" },
  { id: "processed", label: "Processed" },
  { id: "ignored", label: "Ignored" },
] as const;

export default async function SupplierInvoicesPage({ searchParams }: InvoicesPageProps) {
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(supabase, "/admin/materials/invoices");
  const shellProps = await buildAdminAppShellProps(supabase, profile);
  const params = await searchParams;
  const requestedView = params.view ?? "";
  const view = VIEWS.some((item) => item.id === requestedView) ? requestedView : "all";
  const result = await loadInvoiceList(supabase);
  const invoices = result.ok ? result.invoices : [];
  const totals = invoices.reduce((sum, invoice) => {
    for (const [status, count] of Object.entries(invoice.lineCounts)) {
      sum[status as keyof typeof sum] += count;
    }
    return sum;
  }, emptyLineCounts());
  const visible = invoices.filter((invoice) => matchesView(invoice, view));

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="Costing"
          title="Supplier invoices"
          description="Upload a supplier invoice, check the lines against current approved prices, and resolve the exceptions. Nothing on this page changes an approved price."
          actions={
            <Link href="/admin/materials">
              <Button variant="outline">Materials</Button>
            </Link>
          }
        />

        {!result.ok ? (
          <Card className="rounded-2xl border-amber-200 bg-amber-50 shadow-sm ring-0">
            <CardContent className="p-6 text-sm text-amber-950">{result.error}</CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            <Card className="rounded-2xl shadow-sm ring-0">
              <CardContent className="p-6">
                <h2 className="text-lg font-semibold">Upload supplier invoice</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  PDF, JPG, or PNG. The original file stays private.
                </p>
                <div className="mt-4">
                  <InvoiceUploadForm />
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-wrap gap-2">
              <FilterLink href="/admin/materials/invoices" active={view === "all"} label="All" count={invoices.length} />
              <FilterLink
                href="/admin/materials/invoices?view=needs_review"
                active={view === "needs_review"}
                label="Needs review"
                count={totals.needs_review + totals.query}
              />
              <FilterLink
                href="/admin/materials/invoices?view=price_change"
                active={view === "price_change"}
                label="Price changes"
                count={totals.price_change}
              />
              <FilterLink
                href="/admin/materials/invoices?view=unmatched"
                active={view === "unmatched"}
                label="Unmatched"
                count={totals.unmatched}
              />
              <FilterLink
                href="/admin/materials/invoices?view=extraction_error"
                active={view === "extraction_error"}
                label="Extraction errors"
                count={
                  totals.extraction_error +
                  invoices.filter((invoice) => invoice.extractionStatus !== "extracted").length
                }
              />
              <FilterLink
                href="/admin/materials/invoices?view=processed"
                active={view === "processed"}
                label="Processed"
                count={totals.processed}
              />
              <FilterLink
                href="/admin/materials/invoices?view=ignored"
                active={view === "ignored"}
                label="Ignored"
                count={totals.ignored}
              />
            </div>

            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">No invoices in this view.</p>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-border/70">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Invoice</th>
                      <th className="px-4 py-3 font-medium">Supplier</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Exceptions</th>
                      <th className="px-4 py-3 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((invoice) => (
                      <tr key={invoice.id} className="border-t border-border/70">
                        <td className="px-4 py-3">
                          <Link
                            href={`/admin/materials/invoices/${invoice.id}`}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {invoice.invoiceNumber || "Unnumbered invoice"}
                          </Link>
                          <div className="text-muted-foreground">
                            {invoice.invoiceDate || "No date"}
                          </div>
                        </td>
                        <td className="px-4 py-3">{invoice.supplierName || "Supplier not chosen"}</td>
                        <td className="px-4 py-3">
                          {PROCESSING_STATUS_LABELS[invoice.processingStatus]}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {exceptionSummary(invoice)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {invoice.total == null ? "—" : formatGbp(invoice.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function FilterLink({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-full bg-foreground px-3 py-1.5 text-sm text-background"
          : "rounded-full bg-muted px-3 py-1.5 text-sm text-foreground"
      }
    >
      {label} <span className="tabular-nums">{count}</span>
    </Link>
  );
}

function matchesView(invoice: InvoiceListItem, view: string) {
  if (view === "needs_review") {
    return invoice.lineCounts.needs_review + invoice.lineCounts.query > 0;
  }

  if (view === "price_change") {
    return invoice.lineCounts.price_change > 0;
  }

  if (view === "unmatched") {
    return invoice.lineCounts.unmatched > 0;
  }

  if (view === "extraction_error") {
    return (
      invoice.extractionStatus !== "extracted" || invoice.lineCounts.extraction_error > 0
    );
  }

  if (view === "processed") {
    return invoice.processingStatus === "processed";
  }

  if (view === "ignored") {
    return invoice.lineCounts.ignored > 0;
  }

  return true;
}

function exceptionSummary(invoice: InvoiceListItem) {
  const parts = [
    invoice.lineCounts.price_change ? `${invoice.lineCounts.price_change} price changes` : "",
    invoice.lineCounts.unmatched ? `${invoice.lineCounts.unmatched} unmatched` : "",
    invoice.lineCounts.needs_review ? `${invoice.lineCounts.needs_review} to review` : "",
    invoice.lineCounts.extraction_error ? `${invoice.lineCounts.extraction_error} maths` : "",
    invoice.lineCounts.query ? `${invoice.lineCounts.query} queries` : "",
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : `${invoice.lineCounts.processed} matched`;
}
