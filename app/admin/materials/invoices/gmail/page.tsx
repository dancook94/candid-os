import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { GmailImportPanel } from "@/components/materials/gmail-import-panel";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { loadGmailImportView } from "@/lib/gmail/connection";
import { GMAIL_IMPORT_MAILBOX } from "@/lib/gmail/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type GmailImportPageProps = {
  searchParams: Promise<{ error?: string; connected?: string }>;
};

export default async function GmailImportPage({ searchParams }: GmailImportPageProps) {
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(supabase, "/admin/materials/invoices/gmail");
  const shellProps = await buildAdminAppShellProps(supabase, profile);
  const params = await searchParams;
  let view: Awaited<ReturnType<typeof loadGmailImportView>> | null = null;
  let loadError: string | null = null;

  try {
    view = await loadGmailImportView(createAdminClient());
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Gmail discovery could not be loaded.";
  }

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="Costing"
          title="Gmail import"
          description={`Discover supplier documents from ${GMAIL_IMPORT_MAILBOX}. Discovery does not create invoices, materials, or prices.`}
          actions={
            <Link href="/admin/materials/invoices">
              <Button variant="outline">Supplier invoices</Button>
            </Link>
          }
        />
        <Card className="rounded-2xl shadow-sm ring-0">
          <CardContent className="space-y-4 p-6">
            {params.connected === "1" ? (
              <p className="text-sm text-emerald-800">Gmail is connected.</p>
            ) : null}
            {params.error ? <p className="text-sm text-amber-900">{params.error}</p> : null}
            {loadError ? <p className="text-sm text-amber-900">{loadError}</p> : null}
            {view ? (
              <GmailImportPanel connection={view.connection} run={view.run} items={view.items} />
            ) : null}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
