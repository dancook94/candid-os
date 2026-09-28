import Link from "next/link";

import { MaterialForm } from "@/components/materials/material-form";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NewMaterialPage() {
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(supabase, "/admin/materials/new");
  const shellProps = await buildAdminAppShellProps(supabase, profile);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow="Materials"
          title="Add material"
          description="Create one canonical material. Supplier wording and prices are added after this."
          actions={
            <Link href="/admin/materials">
              <Button variant="outline">Back</Button>
            </Link>
          }
        />
        <Card className="portal-surface">
          <CardContent className="p-6">
            <MaterialForm mode="create" />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
