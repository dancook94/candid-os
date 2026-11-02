import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { BulkReviewPanel } from "@/components/materials/bulk-review-panel";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdminPageAccess } from "@/lib/admin-page-access";
import { buildAdminAppShellProps } from "@/lib/admin-shell-props";
import { loadBulkReview } from "@/lib/materials/invoices/bulk-review-actions";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function BulkInvoiceReviewPage() {
  const supabase = await createClient();
  const profile = await requireAdminPageAccess(supabase, "/admin/materials/invoices/bulk-review");
  const shellProps = await buildAdminAppShellProps(supabase, profile);
  const result = await loadBulkReview(supabase);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-7xl">
        <PageHeader
          eyebrow="Costing"
          title="Bulk invoice review"
          description="Decide matching invoice lines together. Each action applies only to the lines you tick, and it does not change future invoices or the current price unless you approve that price separately."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/materials/invoices/exceptions">
                <Button variant="outline">Review queue</Button>
              </Link>
              <Link href="/admin/materials/invoices">
                <Button variant="outline">All invoices</Button>
              </Link>
            </div>
          }
        />
        {result.ok ? (
          <BulkReviewPanel groups={result.groups} summary={result.summary} />
        ) : (
          <Card className="rounded-2xl border-amber-200 bg-amber-50 shadow-sm ring-0">
            <CardContent className="p-6 text-sm text-amber-950">{result.error}</CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
