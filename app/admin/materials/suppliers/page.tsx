import Link from "next/link";

import {
  SupplierCreateForm,
  SupplierEditForm,
} from "@/components/materials/supplier-manager";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { loadSuppliers } from "@/lib/materials/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MaterialSuppliersPage() {
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(
    supabase,
    "/admin/materials/suppliers"
  );
  const shellProps = await buildAdminAppShellProps(supabase, profile);
  const suppliers = await loadSuppliers(supabase);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-4xl">
        <PageHeader
          eyebrow="Materials"
          title="Suppliers"
          description="The companies Candid buys material from. Invoice inboxes and contacts come later."
          actions={
            <Link href="/admin/materials">
              <Button variant="outline">Materials</Button>
            </Link>
          }
        />

        {!suppliers.ok ? (
          <Card className="rounded-2xl border-amber-200 bg-amber-50 shadow-sm ring-0">
            <CardContent className="p-6 text-sm text-amber-950">
              {suppliers.error}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <Card className="portal-surface">
              <CardHeader>
                <CardTitle>Add supplier</CardTitle>
              </CardHeader>
              <CardContent>
                <SupplierCreateForm />
              </CardContent>
            </Card>

            {suppliers.data.length === 0 ? (
              <EmptyState
                title="No suppliers yet"
                description="Add Antalis, Pyramid, or another supplier before mapping their products."
              />
            ) : (
              <Card className="portal-surface">
                <CardContent className="space-y-4 p-6">
                  {suppliers.data.map((supplier) => (
                    <SupplierEditForm key={supplier.id} supplier={supplier} />
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
