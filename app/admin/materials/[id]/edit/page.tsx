import Link from "next/link";
import { notFound } from "next/navigation";

import { MaterialForm } from "@/components/materials/material-form";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { loadMaterialDetail } from "@/lib/materials/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type EditMaterialPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditMaterialPage({ params }: EditMaterialPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(
    supabase,
    `/admin/materials/${id}/edit`
  );
  const shellProps = await buildAdminAppShellProps(supabase, profile);
  const detail = await loadMaterialDetail(supabase, id);

  if (!detail.ok) {
    return (
      <AppShell {...shellProps}>
        <div className="mx-auto max-w-3xl">
          <Card className="rounded-2xl border-amber-200 bg-amber-50 shadow-sm ring-0">
            <CardContent className="p-6 text-sm text-amber-950">
              {detail.error}
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  if (!detail.data) {
    notFound();
  }

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow="Materials"
          title={`Edit ${detail.data.material.name}`}
          description="Deactivate a material to keep its price history. Materials are not deleted."
          actions={
            <Link href={`/admin/materials/${id}`}>
              <Button variant="outline">Back</Button>
            </Link>
          }
        />
        <Card className="portal-surface">
          <CardContent className="p-6">
            <MaterialForm mode="edit" material={detail.data.material} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
