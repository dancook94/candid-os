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
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { loadMaterialsCatalog } from "@/lib/materials/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type MaterialsPageProps = {
  searchParams: Promise<{ q?: string; status?: string; category?: string }>;
};

export default async function MaterialsPage({ searchParams }: MaterialsPageProps) {
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(supabase, "/admin/materials");
  const shellProps = await buildAdminAppShellProps(supabase, profile);
  const params = await searchParams;
  const catalog = await loadMaterialsCatalog(supabase);
  const query = (params.q ?? "").trim().toLowerCase();
  const status = params.status === "inactive" || params.status === "active" ? params.status : "all";
  const category = (params.category ?? "").trim();
  const rows = catalog.ok ? catalog.data : [];
  const categories = [...new Set(rows.map((row) => row.material.category).filter(Boolean))] as string[];
  const filtered = rows.filter((row) => {
    if (status === "active" && !row.material.active) {
      return false;
    }

    if (status === "inactive" && row.material.active) {
      return false;
    }

    if (category && row.material.category !== category) {
      return false;
    }

    if (query && !row.searchText.includes(query)) {
      return false;
    }

    return true;
  });
  const hasFilters = Boolean(query || category || status !== "all");

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="Costing"
          title="Materials"
          description="One row for each canonical material, with its preferred supplier’s current approved cost."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/materials/invoices">
                <Button variant="outline">Invoices</Button>
              </Link>
              <Link href="/admin/materials/suppliers">
                <Button variant="outline">Suppliers</Button>
              </Link>
              <Link href="/admin/materials/new">
                <Button>Add material</Button>
              </Link>
            </div>
          }
        />

        {!catalog.ok ? (
          <Card className="rounded-2xl border-amber-200 bg-amber-50 shadow-sm ring-0">
            <CardContent className="p-6 text-sm text-amber-950">
              {catalog.error}
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="portal-surface mb-6">
              <CardContent className="p-4 sm:p-6">
                <form className="grid gap-4 md:grid-cols-4">
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="q">Search</Label>
                    <Input
                      id="q"
                      name="q"
                      defaultValue={params.q ?? ""}
                      placeholder="Name, supplier, colour, size"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    <Select id="category" name="category" defaultValue={category}>
                      <option value="">All categories</option>
                      {categories.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="status">Status</Label>
                    <Select id="status" name="status" defaultValue={status}>
                      <option value="all">All</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </Select>
                  </div>
                  <div className="flex flex-wrap items-end gap-2 md:col-span-4">
                    <Button type="submit">Apply</Button>
                    {hasFilters ? (
                      <Link href="/admin/materials">
                        <Button type="button" variant="outline">
                          Clear
                        </Button>
                      </Link>
                    ) : null}
                  </div>
                </form>
              </CardContent>
            </Card>

            {rows.length === 0 ? (
              <EmptyState
                title="No materials yet"
                description="Create the first canonical material. Supplier invoices will not appear here until a later phase."
                action={
                  <Link href="/admin/materials/new">
                    <Button>Add material</Button>
                  </Link>
                }
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                title="No materials match"
                description="Try a different search or status."
                action={
                  <Link href="/admin/materials">
                    <Button variant="outline">Clear filters</Button>
                  </Link>
                }
              />
            ) : (
              <Card className="portal-surface overflow-hidden">
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="portal-table">
                      <thead>
                        <tr>
                          <th>Material</th>
                          <th>Category</th>
                          <th>Specification</th>
                          <th>Preferred supplier</th>
                          <th>Purchase format</th>
                          <th>Current cost</th>
                          <th>£/m²</th>
                          <th>Last updated</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((row) => (
                          <tr key={row.material.id}>
                            <td className="p-0">
                              <Link
                                href={`/admin/materials/${row.material.id}`}
                                className="block px-4 py-3.5 font-medium text-foreground"
                              >
                                {row.material.name}
                              </Link>
                            </td>
                            <td className="px-4 py-3.5 text-muted-foreground">
                              {row.material.category ?? "—"}
                            </td>
                            <td className="px-4 py-3.5 text-muted-foreground">
                              {row.specification}
                            </td>
                            <td className="px-4 py-3.5 text-muted-foreground">
                              {row.preferredSupplierName ?? "Select a supplier"}
                            </td>
                            <td className="px-4 py-3.5 text-muted-foreground">
                              {row.purchaseFormat}
                            </td>
                            <td className="px-4 py-3.5">{row.currentCostLabel}</td>
                            <td className="px-4 py-3.5">{row.costPerSquareMetreLabel}</td>
                            <td className="px-4 py-3.5 text-muted-foreground">
                              {row.lastUpdatedLabel}
                            </td>
                            <td className="px-4 py-3.5">
                              <StatusBadge
                                status={row.material.active ? "approved" : "disabled"}
                                label={row.material.active ? "Active" : "Inactive"}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
