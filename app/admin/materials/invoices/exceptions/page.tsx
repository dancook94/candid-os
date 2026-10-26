import Link from "next/link";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import {
  EXCEPTION_KINDS,
  EXCEPTION_LABELS,
  filterInvoiceExceptions,
  invoiceExceptionKinds,
} from "@/lib/materials/invoices/exceptions";
import { loadInvoiceList } from "@/lib/materials/invoices/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ExceptionsPageProps = {
  searchParams: Promise<{ kind?: string; supplier?: string; from?: string; to?: string }>;
};

export default async function InvoiceExceptionsPage({ searchParams }: ExceptionsPageProps) {
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(supabase, "/admin/materials/invoices/exceptions");
  const shellProps = await buildAdminAppShellProps(supabase, profile);
  const params = await searchParams;
  const result = await loadInvoiceList(supabase);
  const invoices = result.ok ? result.invoices : [];
  const suppliers = [...new Set(invoices.map((invoice) => invoice.supplierName).filter(Boolean))].sort() as string[];
  const visible = result.ok
    ? filterInvoiceExceptions(invoices, {
        kind: params.kind,
        supplier: params.supplier,
        from: params.from,
        to: params.to,
      })
    : [];

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="Costing"
          title="Invoice review queue"
          description="These invoices need a person. Opening one uses the existing review screen. Nothing here approves a price or creates a material."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/materials/invoices/gmail">
                <Button variant="outline">Stored invoices</Button>
              </Link>
              <Link href="/admin/materials/invoices">
                <Button variant="outline">All invoices</Button>
              </Link>
            </div>
          }
        />
        {!result.ok ? (
          <Card className="rounded-2xl border-amber-200 bg-amber-50 shadow-sm ring-0">
            <CardContent className="p-6 text-sm text-amber-950">{result.error}</CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <form method="get" className="flex flex-wrap items-end gap-3">
              <FilterSelect label="Show" name="kind" defaultValue={params.kind || "attention"}>
                <option value="attention">{EXCEPTION_LABELS.attention}</option>
                {EXCEPTION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {EXCEPTION_LABELS[kind]}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect label="Supplier" name="supplier" defaultValue={params.supplier || ""}>
                <option value="">All suppliers</option>
                {suppliers.map((supplier) => (
                  <option key={supplier} value={supplier}>
                    {supplier}
                  </option>
                ))}
              </FilterSelect>
              <DateField label="From" name="from" defaultValue={params.from || ""} />
              <DateField label="To" name="to" defaultValue={params.to || ""} />
              <Button type="submit" variant="outline">
                Apply
              </Button>
            </form>
            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing in this view.</p>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-border/70">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Invoice</th>
                      <th className="px-4 py-3 font-medium">Supplier</th>
                      <th className="px-4 py-3 font-medium">Why it is here</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((invoice) => {
                      const reasons = invoiceExceptionKinds(invoice).map((kind) => EXCEPTION_LABELS[kind]);

                      return (
                        <tr key={invoice.id} className="border-t border-border/70">
                          <td className="px-4 py-3">
                            <Link
                              href={`/admin/materials/invoices/${invoice.id}`}
                              className="font-medium underline-offset-4 hover:underline"
                            >
                              {invoice.invoiceNumber || "Unnumbered invoice"}
                            </Link>
                            <div className="text-muted-foreground">{invoice.invoiceDate || "No date"}</div>
                          </td>
                          <td className="px-4 py-3">{invoice.supplierName || "Supplier not chosen"}</td>
                          <td className="px-4 py-3">{reasons.join(", ") || "Needs a person"}</td>
                        </tr>
                      );
                    })}
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

function FilterSelect(props: {
  label: string;
  name: string;
  defaultValue: string;
  children: ReactNode;
}) {
  return (
    <label className="text-sm">
      {props.label}
      <select
        name={props.name}
        defaultValue={props.defaultValue}
        className="mt-1 block h-9 rounded-lg border border-input bg-background px-3 text-sm"
      >
        {props.children}
      </select>
    </label>
  );
}

function DateField(props: { label: string; name: string; defaultValue: string }) {
  return (
    <label className="text-sm">
      {props.label}
      <input
        type="date"
        name={props.name}
        defaultValue={props.defaultValue}
        className="mt-1 block h-9 rounded-lg border border-input bg-background px-3 text-sm"
      />
    </label>
  );
}
