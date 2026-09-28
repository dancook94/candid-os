import Link from "next/link";
import { notFound } from "next/navigation";

import {
  SupplierProductCard,
  SupplierProductCreateForm,
} from "@/components/materials/material-detail-editor";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { PURCHASE_UNIT_LABELS } from "@/lib/materials/units";
import { loadMaterialDetail, loadSuppliers } from "@/lib/materials/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type MaterialDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function MaterialDetailPage({
  params,
}: MaterialDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(supabase, `/admin/materials/${id}`);
  const shellProps = await buildAdminAppShellProps(supabase, profile);
  const [detail, suppliers] = await Promise.all([
    loadMaterialDetail(supabase, id),
    loadSuppliers(supabase),
  ]);

  if (!detail.ok || !suppliers.ok) {
    let message = "Materials could not be loaded.";

    if (!detail.ok) {
      message = detail.error;
    } else if (!suppliers.ok) {
      message = suppliers.error;
    }

    return (
      <AppShell {...shellProps}>
        <div className="mx-auto max-w-5xl">
          <Card className="rounded-2xl border-amber-200 bg-amber-50 shadow-sm ring-0">
            <CardContent className="p-6 text-sm text-amber-950">
              {message}
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  if (!detail.data) {
    notFound();
  }

  const { material, products, history, specification, purchaseFormat } =
    detail.data;

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-5xl">
        <PageHeader
          eyebrow="Materials"
          title={material.name}
          description={material.category ?? "Canonical material"}
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/materials">
                <Button variant="outline">All materials</Button>
              </Link>
              <Link href={`/admin/materials/${material.id}/edit`}>
                <Button>Edit material</Button>
              </Link>
            </div>
          }
        />

        <Card className="portal-surface mb-6">
          <CardContent className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Specification
              </p>
              <p className="mt-1 text-sm">{specification}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Purchase format
              </p>
              <p className="mt-1 text-sm">{purchaseFormat}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Price unit basis
              </p>
              <p className="mt-1 text-sm">
                {PURCHASE_UNIT_LABELS[material.purchaseUnit]}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Status
              </p>
              <div className="mt-1">
                <StatusBadge
                  status={material.active ? "approved" : "disabled"}
                  label={material.active ? "Active" : "Inactive"}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="portal-surface mb-6">
          <CardHeader>
            <CardTitle>Supplier products</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {products.length === 0 ? (
              <EmptyState
                title="No supplier products"
                description="Map the supplier’s own description onto this material. That mapping does not create another material row."
              />
            ) : (
              products.map((product) => (
                <SupplierProductCard
                  key={product.id}
                  product={product}
                  suppliers={suppliers.data}
                  defaultPriceUnit={material.purchaseUnit}
                />
              ))
            )}
            <div className="border-t border-border/70 pt-5">
              <h3 className="mb-4 text-sm font-semibold">Add supplier product</h3>
              <SupplierProductCreateForm
                materialId={material.id}
                suppliers={suppliers.data}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="portal-surface">
          <CardHeader>
            <CardTitle>Approved price history</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {history.length === 0 ? (
              <div className="px-6 pb-6">
                <EmptyState
                  title="No approved prices"
                  description="Prices added here are approved immediately and kept as history. Older rows are not overwritten."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Supplier</th>
                      <th>Price</th>
                      <th>Price unit</th>
                      <th>£/m²</th>
                      <th>Source</th>
                      <th>Approved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.id}>
                        <td className="px-4 py-3.5">{row.effectiveDateLabel}</td>
                        <td className="px-4 py-3.5">
                          <div className="font-medium">{row.supplierName}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.supplierDescription}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">{row.priceLabel}</td>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {row.priceUnitLabel}
                        </td>
                        <td className="px-4 py-3.5">{row.costPerSquareMetreLabel}</td>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {row.sourceLabel}
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {row.approvedAtLabel}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
