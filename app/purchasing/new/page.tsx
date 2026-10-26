import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SupplierPicker } from "@/components/purchasing/supplier-picker";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { buildPortalAppShellProps } from "@/lib/admin-shell-props";
import {
  PURCHASING_DASHBOARD_PATH,
  PURCHASING_NEW_PATH,
  requirePurchasingPageAccess,
} from "@/lib/purchasing/access";
import { createDraftErrorMessage } from "@/lib/purchasing/create-draft";
import { loadActiveSuppliers } from "@/lib/purchasing/suppliers";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type NewPurchaseOrderPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function NewPurchaseOrderPage({
  searchParams,
}: NewPurchaseOrderPageProps) {
  const supabase = await createClient();
  const profile = await requirePurchasingPageAccess(
    supabase,
    PURCHASING_NEW_PATH
  );
  const [{ suppliers, errorMessage }, shellProps, params] = await Promise.all([
    loadActiveSuppliers(supabase),
    buildPortalAppShellProps(supabase, profile, {
      showPurchasingNav: true,
    }),
    searchParams,
  ]);
  const formError = createDraftErrorMessage(params.error);

  return (
    <AppShell {...shellProps}>
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader
          eyebrow="Purchasing"
          title="New purchase order"
          description="Choose an active supplier. This creates a draft and does not send anything to the supplier."
          actions={
            <Link
              href={PURCHASING_DASHBOARD_PATH}
              className={cn(buttonVariants({ variant: "outline" }), "w-full sm:w-auto")}
            >
              All purchase orders
            </Link>
          }
        />

        {formError ? (
          <Card className="portal-surface">
            <CardContent className="px-4 py-4 text-sm text-muted-foreground sm:px-6">
              {formError}
            </CardContent>
          </Card>
        ) : null}

        {errorMessage ? (
          <Card className="portal-surface">
            <CardContent className="px-4 py-8 text-sm text-muted-foreground sm:px-6">
              {errorMessage}
            </CardContent>
          </Card>
        ) : suppliers.length === 0 ? (
          <EmptyState
            title="No active suppliers"
            description="An active supplier is needed before a draft purchase order can be created."
          />
        ) : (
          <Card className="portal-surface">
            <CardContent className="p-4 sm:p-6">
              <SupplierPicker suppliers={suppliers} />
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
