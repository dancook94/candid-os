import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PurchaseOrderList } from "@/components/purchasing/purchase-order-list";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { buildPortalAppShellProps } from "@/lib/admin-shell-props";
import {
  PURCHASING_NEW_PATH,
  requirePurchasingPageAccess,
} from "@/lib/purchasing/access";
import { loadPurchaseOrderList } from "@/lib/purchasing/purchase-orders";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PurchasingDashboardPage() {
  const supabase = await createClient();
  const profile = await requirePurchasingPageAccess(supabase);
  const [{ orders, errorMessage }, shellProps] = await Promise.all([
    loadPurchaseOrderList(supabase),
    buildPortalAppShellProps(supabase, profile, {
      showPurchasingNav: true,
    }),
  ]);

  return (
    <AppShell {...shellProps}>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Purchasing"
          title="Purchase orders"
          description="Orders issued to suppliers, including drafts that have not been sent."
          actions={
            <Link
              href={PURCHASING_NEW_PATH}
              className={cn(buttonVariants(), "w-full sm:w-auto")}
            >
              New purchase order
            </Link>
          }
        />

        {errorMessage ? (
          <Card className="portal-surface">
            <CardContent className="px-4 py-8 text-sm text-muted-foreground sm:px-6">
              {errorMessage}
            </CardContent>
          </Card>
        ) : orders.length === 0 ? (
          <EmptyState
            title="No purchase orders yet"
            description="Draft and issued purchase orders will appear here."
          />
        ) : (
          <PurchaseOrderList orders={orders} />
        )}
      </div>
    </AppShell>
  );
}
