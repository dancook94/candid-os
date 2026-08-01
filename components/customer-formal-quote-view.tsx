import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type BadgeStatus =
  | "pending"
  | "approved"
  | "disabled"
  | "draft"
  | "sent"
  | "accepted"
  | "declined";

export type CustomerFormalQuoteLineItem = {
  id: string;
  title: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  isOptional: boolean;
  imageUrl: string | null;
  imageFileName: string | null;
};

export type CustomerFormalQuoteViewProps = {
  quoteNumber: number;
  projectName: string;
  quoteStatus: string;
  versionNumber: number;
  expiryDate: string | null;
  paymentTermsDays: number | null;
  introduction: string | null;
  customerNotes: string | null;
  subtotal: number;
  vatAmount: number;
  total: number;
  lineItems: CustomerFormalQuoteLineItem[];
  linkedRequestId: string | null;
};

const customerQuoteStatusLabels: Record<string, string> = {
  sent: "Quote sent",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  superseded: "Updated quote available",
};

const customerQuoteStatusBadgeMap: Record<string, BadgeStatus> = {
  sent: "sent",
  accepted: "accepted",
  declined: "declined",
  expired: "disabled",
  superseded: "pending",
};

function formatGbp(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(value);
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getCustomerQuoteStatusLabel(status: string) {
  return customerQuoteStatusLabels[status.toLowerCase()] ?? "Quote sent";
}

function mapCustomerQuoteStatusToBadge(status: string): BadgeStatus {
  return customerQuoteStatusBadgeMap[status.toLowerCase()] ?? "sent";
}

export function CustomerFormalQuoteView({
  quoteNumber,
  projectName,
  quoteStatus,
  versionNumber,
  expiryDate,
  paymentTermsDays,
  introduction,
  customerNotes,
  subtotal,
  vatAmount,
  total,
  lineItems,
  linkedRequestId,
}: CustomerFormalQuoteViewProps) {
  const backHref = linkedRequestId ? `/quotes/${linkedRequestId}` : "/quotes";

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={projectName}
        description={`Quote Q-${quoteNumber} · Version ${versionNumber}`}
        actions={
          <Link href={backHref}>
            <Button variant="outline">Back to quotes</Button>
          </Link>
        }
      />

      <Card className="rounded-2xl border-neutral-200 shadow-sm ring-0">
        <CardHeader className="border-b border-neutral-200">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="text-lg font-semibold text-neutral-950">
                Your quote
              </CardTitle>
              <p className="mt-1 text-sm text-neutral-500">
                Review line items, pricing and notes below.
              </p>
            </div>
            <StatusBadge
              status={mapCustomerQuoteStatusToBadge(quoteStatus)}
              label={getCustomerQuoteStatusLabel(quoteStatus)}
            />
          </div>
        </CardHeader>

        <CardContent className="space-y-6 pt-6">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            {expiryDate && (
              <div>
                <dt className="text-neutral-500">Valid until</dt>
                <dd className="mt-1 font-medium text-neutral-950">
                  {formatDate(expiryDate)}
                </dd>
              </div>
            )}
            {paymentTermsDays !== null && (
              <div>
                <dt className="text-neutral-500">Payment terms</dt>
                <dd className="mt-1 font-medium text-neutral-950">
                  {paymentTermsDays} days
                </dd>
              </div>
            )}
          </dl>

          {introduction && (
            <div className="text-sm">
              <p className="text-neutral-500">Introduction</p>
              <p className="mt-1 whitespace-pre-wrap text-neutral-950">
                {introduction}
              </p>
            </div>
          )}

          <div className="space-y-3">
            <h2 className="text-sm font-medium text-neutral-950">Line items</h2>

            {lineItems.map((item) => (
              <article
                key={item.id}
                className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  {item.imageUrl ? (
                    <div className="flex h-40 w-40 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 sm:h-44 sm:w-44">
                      <img
                        src={item.imageUrl}
                        alt={
                          item.imageFileName
                            ? `${item.title} — ${item.imageFileName}`
                            : item.title
                        }
                        className="h-full w-full object-contain"
                      />
                    </div>
                  ) : null}

                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium text-neutral-950">
                        {item.title}
                      </h3>
                      {item.isOptional && (
                        <span className="inline-flex items-center rounded-md bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-600 ring-1 ring-neutral-200">
                          Optional
                        </span>
                      )}
                    </div>

                    {item.description && (
                      <p className="text-sm text-neutral-600">
                        {item.description}
                      </p>
                    )}

                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                      <div>
                        <dt className="text-neutral-500">Quantity</dt>
                        <dd className="font-medium text-neutral-950">
                          {item.quantity}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-neutral-500">Unit price</dt>
                        <dd className="font-medium text-neutral-950">
                          {formatGbp(item.unitPrice)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-neutral-500">Line total</dt>
                        <dd className="font-medium text-neutral-950">
                          {formatGbp(item.lineTotal)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {customerNotes && (
            <div className="text-sm">
              <p className="text-neutral-500">Notes</p>
              <p className="mt-1 whitespace-pre-wrap text-neutral-950">
                {customerNotes}
              </p>
            </div>
          )}

          <div className="flex justify-end">
            <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-neutral-500">Subtotal</dt>
                  <dd className="font-medium text-neutral-950">
                    {formatGbp(subtotal)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-neutral-500">VAT (20%)</dt>
                  <dd className="font-medium text-neutral-950">
                    {formatGbp(vatAmount)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 border-t border-neutral-200 pt-3">
                  <dt className="font-medium text-neutral-950">
                    Total including VAT
                  </dt>
                  <dd className="text-lg font-semibold text-neutral-950">
                    {formatGbp(total)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
