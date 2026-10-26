import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { formatGbp } from "@/lib/format-currency";
import { PURCHASING_DASHBOARD_PATH, purchaseOrderIssuePath } from "@/lib/purchasing/access";
import {
  formatPurchaseOrderDate,
  type PurchaseOrderListItem,
} from "@/lib/purchasing/purchase-orders";
import type { PurchaseOrderDetail } from "@/lib/purchasing/purchase-order-detail";
import { cn } from "@/lib/utils";

export function purchaseOrderHref(orderId: string) {
  return `/purchasing/${orderId}`;
}

type PurchaseOrderListProps = {
  orders: PurchaseOrderListItem[];
};

function PurchaseOrderStatusBadge({
  order,
}: {
  order: Pick<PurchaseOrderListItem, "badgeStatus" | "statusLabel">;
}) {
  return <StatusBadge status={order.badgeStatus} label={order.statusLabel} />;
}

export function PurchaseOrderList({ orders }: PurchaseOrderListProps) {
  return (
    <>
      <div className="space-y-3 md:hidden">
        {orders.map((order) => (
          <Link
            key={order.id}
            href={purchaseOrderHref(order.id)}
            className="block rounded-xl border border-border bg-card p-4 shadow-sm transition-colors active:bg-muted/40"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-semibold text-foreground">
                {order.reference}
              </p>
              <PurchaseOrderStatusBadge order={order} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4">
              <PurchaseOrderFields order={order} />
            </dl>
          </Link>
        ))}
      </div>

      <Card className="portal-surface hidden overflow-hidden md:block">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Purchase order</th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th>Order total</th>
                  <th>Created</th>
                  <th>Issued</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td className="p-4 font-medium text-foreground">
                      <Link
                        href={purchaseOrderHref(order.id)}
                        className="underline-offset-4 hover:underline"
                      >
                        {order.reference}
                      </Link>
                    </td>
                    <td className="p-4 text-muted-foreground">
                      {order.supplierName}
                    </td>
                    <td className="p-4">
                      <PurchaseOrderStatusBadge order={order} />
                    </td>
                    <td className="p-4 font-medium">
                      {order.totalIncVat === null
                        ? "—"
                        : formatGbp(order.totalIncVat)}
                    </td>
                    <td className="p-4 text-muted-foreground">
                      {formatPurchaseOrderDate(order.createdAt) ?? "—"}
                    </td>
                    <td className="p-4 text-muted-foreground">
                      {formatPurchaseOrderDate(order.issuedAt) ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function PurchaseOrderFields({ order }: { order: PurchaseOrderListItem }) {
  return (
    <>
      <div>
        <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Supplier
        </dt>
        <dd className="mt-1 text-sm text-foreground">{order.supplierName}</dd>
      </div>
      <div>
        <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Order total
        </dt>
        <dd className="mt-1 text-sm font-medium text-foreground">
          {order.totalIncVat === null ? "—" : formatGbp(order.totalIncVat)}
        </dd>
      </div>
      <div>
        <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Created
        </dt>
        <dd className="mt-1 text-sm text-muted-foreground">
          {formatPurchaseOrderDate(order.createdAt) ?? "—"}
        </dd>
      </div>
      <div>
        <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Issued
        </dt>
        <dd className="mt-1 text-sm text-muted-foreground">
          {formatPurchaseOrderDate(order.issuedAt) ?? "—"}
        </dd>
      </div>
    </>
  );
}

export function PurchaseOrderDetailView({
  order,
  hideLineNote = false,
}: {
  order: PurchaseOrderDetail;
  hideLineNote?: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <PurchaseOrderStatusBadge order={order} />
        {order.revisionNumber ? (
          <p className="text-sm text-muted-foreground">
            Revision {order.revisionNumber}
          </p>
        ) : null}
      </div>

      <Card className="portal-surface">
        <CardContent className="p-4 sm:p-6">
          <dl className="grid gap-5 sm:grid-cols-2">
            <DetailField label="Supplier" value={order.supplierName} />
            <DetailField
              label="Orders email"
              value={order.ordersEmail ?? "Not recorded"}
            />
            <DetailField
              label="Created"
              value={formatPurchaseOrderDate(order.createdAt) ?? "—"}
            />
            <DetailField
              label="Issued"
              value={formatPurchaseOrderDate(order.issuedAt) ?? "—"}
            />
            <DetailField label="Currency" value={order.currency} />
            <DetailField label="VAT" value={order.vatTreatmentLabel} />
            <DetailField label="Delivery" value={order.deliveryLabel} />
            <DetailField
              label="Order total"
              value={
                order.totalIncVat === null ? "—" : formatGbp(order.totalIncVat)
              }
            />
          </dl>
        </CardContent>
      </Card>

      {hideLineNote ? null : order.lineCount === 0 ? (
        <EmptyState
          title="No line items"
          description="This purchase order does not have any line items."
        />
      ) : (
        <Card className="portal-surface">
          <CardContent className="px-4 py-6 text-sm text-muted-foreground sm:px-6">
            {order.lineCount === 1
              ? "1 line item is recorded on this revision."
              : `${order.lineCount} line items are recorded on this revision.`}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        {order.issuedAt ? (
          <a
            href={`/api/purchasing/${order.id}/pdf`}
            className={cn(buttonVariants({ variant: "default" }), "w-full sm:w-auto")}
          >
            Download PDF
          </a>
        ) : null}
        {order.status === "draft" ? (
          <Link
            href={purchaseOrderIssuePath(order.id)}
            className={cn(buttonVariants({ variant: "default" }), "w-full sm:w-auto")}
          >
            Review and issue
          </Link>
        ) : null}
        <Link
          href={PURCHASING_DASHBOARD_PATH}
          className={cn(buttonVariants({ variant: "outline" }), "w-full sm:w-auto")}
        >
          All purchase orders
        </Link>
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="portal-field-label">{label}</dt>
      <dd className="portal-detail-value">{value}</dd>
    </div>
  );
}
