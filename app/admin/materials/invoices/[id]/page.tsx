import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import {
  InvoiceLineList,
  InvoiceReprocessButton,
  InvoiceSupplierForm,
} from "@/components/materials/invoice-review-panel";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { formatGbp } from "@/lib/materials/invoices/money";
import {
  PROCESSING_STATUS_LABELS,
  type InvoiceExtractionStatus,
  type InvoiceProcessingStatus,
} from "@/lib/materials/invoices/model";
import { loadInvoiceDetail } from "@/lib/materials/invoices/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type InvoicePageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ duplicate?: string }>;
};

export default async function SupplierInvoicePage({
  params,
  searchParams,
}: InvoicePageProps) {
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(supabase, `/admin/materials/invoices/${id}`);
  const shellProps = await buildAdminAppShellProps(supabase, profile);
  const result = await loadInvoiceDetail(supabase, id);

  if (!result.ok) {
    return (
      <AppShell {...shellProps}>
        <div className="mx-auto max-w-3xl">
          <PageHeader eyebrow="Costing" title="Supplier invoice" />
          <Card className="rounded-2xl border-amber-200 bg-amber-50 shadow-sm ring-0">
            <CardContent className="p-6 text-sm text-amber-950">{result.error}</CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  const invoice = result.invoice;
  const rawWarnings: unknown = invoice.extraction_warnings;
  const warnings = Array.isArray(rawWarnings)
    ? rawWarnings.filter((item): item is string => typeof item === "string")
    : [];
  const priceChanges = result.lines.filter((line) => line.reviewStatus === "price_change").length;
  const unmatched = result.lines.filter((line) => line.reviewStatus === "unmatched").length;
  const supplierName =
    result.suppliers.find((supplier) => supplier.id === invoice.supplier_id)?.name ??
    invoice.raw_supplier_name;

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-5xl">
        <PageHeader
          eyebrow="Costing"
          title={invoice.invoice_number || "Supplier invoice"}
          description="Exceptions are shown first. Matched lines stay folded. Approved material prices are not changed from this screen."
          actions={
            <Link href="/admin/materials/invoices">
              <Button variant="outline">All invoices</Button>
            </Link>
          }
        />

        {query.duplicate === "1" ? (
          <Card className="mb-6 rounded-2xl border-amber-200 bg-amber-50 shadow-sm ring-0">
            <CardContent className="p-4 text-sm text-amber-950">
              This file or invoice number was already uploaded. The existing invoice is shown.
            </CardContent>
          </Card>
        ) : null}

        <div className="mb-6 flex flex-wrap gap-3 text-sm">
          <SummaryPill label="Price changes" value={priceChanges} />
          <SummaryPill label="Unmatched" value={unmatched} />
          <SummaryPill
            label="Status"
            value={PROCESSING_STATUS_LABELS[invoice.processing_status as InvoiceProcessingStatus]}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="space-y-6">
            <Card className="rounded-2xl shadow-sm ring-0">
              <CardContent className="space-y-4 p-6">
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <Fact label="Supplier on the document" value={invoice.raw_supplier_name || "Not labelled"} />
                  <Fact label="Resolved supplier" value={supplierName || "Not chosen"} />
                  <Fact label="Invoice date" value={invoice.invoice_date || "Not found"} />
                  <Fact label="Received" value={formatReceived(invoice.received_at)} />
                  <Fact label="Subtotal" value={money(invoice.subtotal)} />
                  <Fact label="VAT" value={money(invoice.vat)} />
                  <Fact label="Total" value={money(invoice.total)} />
                  <Fact
                    label="Extraction"
                    value={extractionLabel(invoice.extraction_status as InvoiceExtractionStatus)}
                  />
                </dl>
                {warnings.length > 0 ? (
                  <ul className="space-y-1 text-sm text-amber-900">
                    {warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
                <InvoiceSupplierForm
                  invoiceId={invoice.id}
                  supplierId={invoice.supplier_id}
                  suppliers={result.suppliers.map((supplier) => ({
                    id: supplier.id,
                    name: supplier.name,
                  }))}
                />
              </CardContent>
            </Card>

            <InvoiceLineList
              invoiceId={invoice.id}
              lines={result.lines}
              supplierChosen={Boolean(invoice.supplier_id)}
              products={result.products.map((product) => ({
                id: product.id,
                label: `${product.materialName} — ${product.description}`,
              }))}
            />

            {result.events.length > 0 ? (
              <details className="rounded-2xl border border-border/70">
                <summary className="cursor-pointer px-5 py-4 text-sm font-medium">
                  Audit history
                </summary>
                <ul className="space-y-2 border-t border-border/70 px-5 py-4 text-sm text-muted-foreground">
                  {result.events.map((event) => (
                    <li key={event.id}>
                      {eventLabel(event.action, event.metadata)} · {formatReceived(event.created_at)}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>

          <aside className="space-y-3">
            <h2 className="text-sm font-semibold">Original invoice</h2>
            {result.file ? (
              <a
                href={`/api/admin/materials/invoices/${invoice.id}/file`}
                className="block rounded-2xl border border-border/70 px-4 py-3 text-sm underline-offset-4 hover:underline"
              >
                {result.file.original_filename}
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">No file is stored.</p>
            )}
            <p className="text-xs text-muted-foreground">
              The file is private and opens only for an approved admin.
            </p>
            <InvoiceReprocessButton invoiceId={invoice.id} />
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-border/70 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function money(value: unknown) {
  if (value == null || value === "") {
    return "Not found";
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? formatGbp(parsed) : "Not found";
}

function formatReceived(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function eventLabel(action: string, metadata: unknown) {
  const reprocessed =
    metadata != null &&
    typeof metadata === "object" &&
    "reprocessed" in metadata &&
    metadata.reprocessed === true;

  if (reprocessed && action === "extraction_completed") {
    return "extraction reprocessed";
  }

  return action.replaceAll("_", " ");
}

function extractionLabel(status: InvoiceExtractionStatus) {
  if (status === "extracted") return "Text extracted";
  if (status === "needs_ocr") return "Needs OCR";
  return "Failed";
}
