import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { GmailBulkPanel } from "@/components/materials/gmail-bulk-panel";
import { GmailImportPanel } from "@/components/materials/gmail-import-panel";
import { GmailPromotionPanel } from "@/components/materials/gmail-promotion-panel";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { loadGmailImportView } from "@/lib/gmail/connection";
import { GMAIL_IMPORT_MAILBOX } from "@/lib/gmail/config";
import { resolveDiscoveryWindow } from "@/lib/gmail/window";
import { invoiceExceptionKinds } from "@/lib/materials/invoices/exceptions";
import { loadGmailPromotionPreview } from "@/lib/materials/invoices/gmail-promotion";
import { loadInvoiceProcessingView } from "@/lib/materials/invoices/processing-store";
import { loadInvoiceList } from "@/lib/materials/invoices/queries";
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
  const suggestedWindow = resolveDiscoveryWindow({ preset: "historical" });
  const [promotion, invoiceList, processing, discovery] = await Promise.all([
    loadGmailPromotionPreview(supabase).catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : "Stored Gmail invoices could not be loaded.",
    })),
    loadInvoiceList(supabase).catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : "The invoice queue could not be loaded.",
    })),
    loadInvoiceProcessingView(supabase).catch(() => ({ available: false as const })),
    Promise.resolve()
      .then(() => loadGmailImportView(createAdminClient()))
      .then((view) => ({ view, loadError: null as string | null }))
      .catch((error: unknown) => ({
        view: null,
        loadError: error instanceof Error ? error.message : "Gmail discovery could not be loaded.",
      })),
  ]);
  const { view, loadError } = discovery;

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
            <GmailBulkPanel
              rows={promotion.ok ? promotion.rows : []}
              error={promotion.ok ? null : promotion.error}
              background={processing.available ? "ready" : "unavailable"}
              persisted={processing.available ? processing.run : null}
              reviewCount={
                invoiceList.ok
                  ? invoiceList.invoices.filter((invoice) =>
                      invoiceExceptionKinds(invoice).some((kind) => kind !== "ready")
                    ).length
                  : null
              }
            />
            {params.connected === "1" ? (
              <p className="text-sm text-emerald-800">Gmail is connected.</p>
            ) : null}
            {params.error ? <p className="text-sm text-amber-900">{params.error}</p> : null}
            {loadError ? <p className="text-sm text-amber-900">{loadError}</p> : null}
            {view ? (
              <GmailImportPanel
                connection={view.connection}
                run={view.run}
                items={view.items}
                suggestedFrom={suggestedWindow.dateFrom}
                suggestedTo={suggestedWindow.dateTo}
              />
            ) : null}
            <GmailPromotionPanel
              rows={promotion.ok ? promotion.rows : []}
              error={promotion.ok ? null : promotion.error}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
