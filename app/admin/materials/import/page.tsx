import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { InitialImportPanel } from "@/components/materials/initial-import-panel";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { INITIAL_IMPORT_CATALOG_VERSION, INITIAL_IMPORT_MATERIALS } from "@/lib/materials/initial-import-catalog";
import {
  MEDIUM_IMPORT_CATALOG_VERSION,
  MEDIUM_IMPORT_MATERIALS,
} from "@/lib/materials/medium-import-catalog";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function InitialMaterialImportPage() {
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(
    supabase,
    "/admin/materials/import"
  );
  const shellProps = await buildAdminAppShellProps(supabase, profile);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="Costing"
          title="Approved materials import"
          description="Choose batch 1 or batch 2, run a dry import, then confirm in a separate step. Opening this page does not load a preview or write anything."
          actions={
            <Link href="/admin/materials">
              <Button variant="outline">Back to materials</Button>
            </Link>
          }
        />
        <InitialImportPanel
          batches={[
            {
              catalogVersion: INITIAL_IMPORT_CATALOG_VERSION,
              materialNames: INITIAL_IMPORT_MATERIALS.map((material) => material.name),
            },
            {
              catalogVersion: MEDIUM_IMPORT_CATALOG_VERSION,
              materialNames: MEDIUM_IMPORT_MATERIALS.map((material) => material.name),
            },
          ]}
        />
      </div>
    </AppShell>
  );
}
