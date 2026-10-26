import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { IssuePurchaseOrderForm } from "@/components/purchasing/issue-purchase-order-form";
import { Card, CardContent } from "@/components/ui/card";
import { buildPortalAppShellProps } from "@/lib/admin-shell-props";
import { formatGbp } from "@/lib/format-currency";
import {
  PURCHASING_DASHBOARD_PATH,
  purchaseOrderDetailPath,
  purchaseOrderIssuePath,
  requirePurchasingPageAccess,
} from "@/lib/purchasing/access";
import { isPurchaseOrderSupplierId } from "@/lib/purchasing/create-draft";
import { loadPurchaseOrderEditor } from "@/lib/purchasing/draft-editor-data";
import { validateIssueReady } from "@/lib/purchasing/issue";
import { estimateDraftTotals } from "@/lib/purchasing/draft-editor";
import { loadPurchaseOrderDetail } from "@/lib/purchasing/purchase-order-detail";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type IssuePurchaseOrderPageProps = {
  params: Promise<{ id: string }>;
};

export default async function IssuePurchaseOrderPage({ params }: IssuePurchaseOrderPageProps) {
  const supabase = await createClient();
  const { id } = await params;
  const returnPath = isPurchaseOrderSupplierId(id)
    ? purchaseOrderIssuePath(id)
    : PURCHASING_DASHBOARD_PATH;
  const profile = await requirePurchasingPageAccess(supabase, returnPath);
  const [{ detail }, editor, shellProps] = await Promise.all([
    loadPurchaseOrderDetail(supabase, id),
    isPurchaseOrderSupplierId(id) ? loadPurchaseOrderEditor(supabase, id) : Promise.resolve(null),
    buildPortalAppShellProps(supabase, profile, { showPurchasingNav: true }),
  ]);
  const ready = detail?.status === "draft" && editor ? editor : null;
  const blocker = ready ? validateIssueReady(ready.draft) : null;
  const totals = ready ? estimateDraftTotals(ready.draft) : null;

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          eyebrow="Purchasing"
          title="Issue purchase order"
          description={detail?.supplierName ?? "Review the saved draft before issuing it."}
        />

        {!ready || !detail || !totals ? (
          <Card className="portal-surface">
            <CardContent className="space-y-4 px-4 py-8 text-sm text-muted-foreground sm:px-6">
              <p>Only a saved draft can be issued from this screen.</p>
              <Link href={purchaseOrderDetailPath(id)} className="text-foreground underline">
                Back to the purchase order
              </Link>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="portal-surface">
              <CardContent className="space-y-4 px-4 py-6 text-sm sm:px-6">
                <div>
                  <p className="portal-field-label">Supplier</p>
                  <p className="portal-detail-value">{detail.supplierName}</p>
                  <p className="text-muted-foreground">
                    {ready.draft.supplierOrdersEmail || "No supplier email"}
                  </p>
                </div>
                <p>
                  {ready.draft.deliveryMethod === "workshop"
                    ? "Delivery is the workshop address. Issuing copies that address onto this revision."
                    : `Delivery: ${[ready.draft.deliveryRecipient, ready.draft.deliveryLine1, ready.draft.deliveryPostcode].filter((part) => part.trim()).join(", ")}`}
                </p>
                <div className="space-y-3">
                  {ready.draft.lines.map((line, index) => (
                    <div key={line.key} className="flex items-start justify-between gap-4">
                      <div>
                        <p>{line.description || `Line ${index + 1}`}</p>
                        <p className="text-muted-foreground">
                          {line.quantity} {line.unit}
                        </p>
                      </div>
                      <p>{line.unitPriceExVat ? `${line.unitPriceExVat} ex VAT` : ""}</p>
                    </div>
                  ))}
                </div>
                <p className="text-base font-medium">
                  Total {formatGbp(totals.totalIncVat)} including VAT
                </p>
              </CardContent>
            </Card>

            <Card className="portal-surface">
              <CardContent className="space-y-4 px-4 py-6 text-sm sm:px-6">
                <p>
                  Issuing assigns the next official purchase order number and keeps this revision
                  as the issued record. The draft editor will no longer change it. This does not
                  email the supplier.
                </p>
                {blocker ? (
                  <p className="text-destructive" role="alert">
                    {blocker}
                  </p>
                ) : null}
                <IssuePurchaseOrderForm
                  orderId={id}
                  idempotencyKey={crypto.randomUUID()}
                  disabled={Boolean(blocker)}
                />
                <Link href={purchaseOrderDetailPath(id)} className="inline-block text-foreground underline">
                  Back to the draft
                </Link>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
