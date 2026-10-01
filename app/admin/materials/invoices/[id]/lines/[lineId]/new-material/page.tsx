import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { InvoiceNewMaterialForm } from "@/components/materials/invoice-new-material-form";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { proposeMaterialFromInvoiceLine } from "@/lib/materials/invoices/new-material";
import { loadInvoiceDetail } from "@/lib/materials/invoices/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type NewMaterialPageProps = {
  params: Promise<{ id: string; lineId: string }>;
};

export default async function NewMaterialFromInvoicePage({ params }: NewMaterialPageProps) {
  const { id, lineId } = await params;
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(
    supabase,
    `/admin/materials/invoices/${id}/lines/${lineId}/new-material`
  );
  const shellProps = await buildAdminAppShellProps(supabase, profile);
  const result = await loadInvoiceDetail(supabase, id);
  const line = result.ok ? result.lines.find((item) => item.id === lineId) : null;
  const supplierName =
    result.ok
      ? result.suppliers.find((supplier) => supplier.id === result.invoice.supplier_id)?.name ?? ""
      : "";
  const eligible = line?.reviewStatus === "needs_review" || line?.reviewStatus === "unmatched";

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow="Costing"
          title="Create material from invoice line"
          description="Review the proposed material before anything is saved. Creating it adds one opening price for a new supplier product."
          actions={
            <Link href={`/admin/materials/invoices/${id}`}>
              <Button variant="outline">Back to invoice</Button>
            </Link>
          }
        />
        {!result.ok || !line || !result.invoice.supplier_id || !eligible ? (
          <Card className="rounded-2xl border-amber-200 bg-amber-50 shadow-sm ring-0">
            <CardContent className="p-6 text-sm text-amber-950">
              {result.ok
                ? "This line needs a supplier, and it must still be unmatched or in review."
                : result.error}
            </CardContent>
          </Card>
        ) : (
          <Card className="rounded-2xl shadow-sm ring-0">
            <CardContent className="p-6">
              <InvoiceNewMaterialForm
                invoiceId={id}
                lineId={lineId}
                supplierName={supplierName}
                effectiveDate={result.invoice.invoice_date ?? ""}
                proposal={proposeMaterialFromInvoiceLine({
                  description: line.reviewedDescription ?? line.rawDescription,
                  sku: line.reviewedSupplierSku ?? line.rawSupplierSku,
                  unit: line.reviewedUnit ?? line.rawUnit,
                  unitPrice: line.reviewedUnitPrice ?? line.rawUnitPrice,
                })}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
