import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { PurchaseOrderDraftEditor } from "@/components/purchasing/draft-editor";
import { PurchaseOrderDetailView } from "@/components/purchasing/purchase-order-list";
import { Card, CardContent } from "@/components/ui/card";
import { buildPortalAppShellProps } from "@/lib/admin-shell-props";
import {
  PURCHASING_DASHBOARD_PATH,
  purchaseOrderDetailPath,
  requirePurchasingPageAccess,
} from "@/lib/purchasing/access";
import { isPurchaseOrderSupplierId } from "@/lib/purchasing/create-draft";
import { loadPurchaseOrderEditor } from "@/lib/purchasing/draft-editor-data";
import { loadPurchaseOrderDetail } from "@/lib/purchasing/purchase-order-detail";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PurchaseOrderDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function PurchaseOrderDetailPage({
  params,
}: PurchaseOrderDetailPageProps) {
  const supabase = await createClient();
  const { id } = await params;
  const profile = await requirePurchasingPageAccess(
    supabase,
    isPurchaseOrderSupplierId(id)
      ? purchaseOrderDetailPath(id)
      : PURCHASING_DASHBOARD_PATH
  );
  const [{ detail, errorMessage }, shellProps] = await Promise.all([
    loadPurchaseOrderDetail(supabase, id),
    buildPortalAppShellProps(supabase, profile, {
      showPurchasingNav: true,
    }),
  ]);
  const editor =
    detail?.status === "draft" ? await loadPurchaseOrderEditor(supabase, id) : null;

  return (
    <AppShell {...shellProps}>
      <div className={editor ? "mx-auto max-w-5xl space-y-6" : "mx-auto max-w-3xl space-y-6"}>
        <PageHeader
          eyebrow="Purchasing"
          title={detail?.reference ?? "Purchase order"}
          description={
            detail
              ? detail.supplierName
              : "This purchase order could not be opened."
          }
        />

        {errorMessage || !detail ? (
          <Card className="portal-surface">
            <CardContent className="px-4 py-8 text-sm text-muted-foreground sm:px-6">
              {errorMessage ?? "This purchase order is not available."}
            </CardContent>
          </Card>
        ) : (
          <>
            <PurchaseOrderDetailView order={detail} hideLineNote={Boolean(editor)} />
            {detail.status === "draft" && !editor ? (
              <Card className="portal-surface">
                <CardContent className="px-4 py-8 text-sm text-muted-foreground sm:px-6">
                  The draft editor could not be loaded.
                </CardContent>
              </Card>
            ) : null}
            {editor ? (
              <PurchaseOrderDraftEditor
                revisionId={editor.revisionId}
                initialDraft={editor.draft}
                catalogue={editor.catalogue}
                jobs={editor.jobs}
                catalogueError={editor.catalogueError}
                jobsError={editor.jobsError}
              />
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}
