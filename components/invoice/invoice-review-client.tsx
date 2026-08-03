"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  INVOICE_DRAFT_STATUS_LABELS,
  PRICING_SOURCE_LABELS,
} from "@/lib/invoice/constants";
import type { XeroPayloadPreview } from "@/lib/invoice/types";
import { MANIFEST_BILLING_STATUS_LABELS } from "@/lib/manifest/constants";
import { MANIFEST_SOURCE_TYPE_LABELS } from "@/lib/manifest/constants";
import type { InvoiceReviewData } from "@/lib/invoice/types";
import { formatGbp } from "@/lib/format-currency";

type InvoiceReviewClientProps = {
  jobId: string;
  jobReference: string;
  companyName: string;
  quoteLabel: string | null;
  opportunityTitle: string | null;
  initialData: InvoiceReviewData;
  xeroPreview: XeroPayloadPreview;
};

export function InvoiceReviewClient({
  jobId,
  jobReference,
  companyName,
  quoteLabel,
  opportunityTitle,
  initialData,
  xeroPreview,
}: InvoiceReviewClientProps) {
  const [data, setData] = useState(initialData);
  const [error, setError] = useState("");
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);

  async function updateLine(itemId: string, fields: Record<string, unknown>) {
    setBusyItemId(itemId);
    setError("");

    try {
      const response = await fetch(`/api/admin/jobs/${jobId}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_item", itemId, ...fields }),
      });

      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to update invoice line.");
      }

      window.location.reload();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Unable to update invoice line."
      );
    } finally {
      setBusyItemId(null);
    }
  }

  async function approveDraft() {
    setIsApproving(true);
    setError("");

    try {
      const response = await fetch(`/api/admin/jobs/${jobId}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", draftId: data.draft.id }),
      });

      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to approve invoice draft.");
      }

      window.location.reload();
    } catch (approveError) {
      setError(
        approveError instanceof Error
          ? approveError.message
          : "Unable to approve invoice draft."
      );
    } finally {
      setIsApproving(false);
    }
  }

  if (data.schemaMissing) {
    return (
      <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-6 text-sm text-amber-900">
        Invoice draft tables are not configured yet. Apply the manifest and invoice migration in Supabase.
      </div>
    );
  }

  if (data.error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
        {data.error}
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-6">
        <div className="portal-surface rounded-xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Invoice review
              </p>
              <h1 className="mt-1 text-2xl font-semibold text-foreground">{jobReference}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{companyName}</p>
            </div>
            <div className="text-right text-sm text-muted-foreground">
              <p>{quoteLabel ? `Accepted quote ${quoteLabel}` : "No quote linked"}</p>
              {opportunityTitle ? <p>{opportunityTitle}</p> : null}
              <p className="mt-2 font-medium text-foreground">
                Status: {INVOICE_DRAFT_STATUS_LABELS[data.draft.status]}
              </p>
            </div>
          </div>
        </div>

        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {data.unpricedCount > 0 ? (
          <p className="rounded-lg border border-amber-300/50 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {data.unpricedCount} billable item(s) still require pricing before approval.
          </p>
        ) : null}

        <section className="portal-surface rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Originally quoted</h2>
          <div className="mt-4 space-y-3">
            {data.quotedItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No quoted manifest items.</p>
            ) : (
              data.quotedItems.map((item) => (
                <div key={item.id} className="rounded-lg border border-border/70 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{item.item_name}</p>
                    <span className="text-xs text-muted-foreground">
                      {MANIFEST_SOURCE_TYPE_LABELS[item.source_type]}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    Qty {item.quoted_quantity ?? item.quantity ?? "—"} ·{" "}
                    {MANIFEST_BILLING_STATUS_LABELS[item.billing_status]}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="portal-surface rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Production changes</h2>
          <div className="mt-4 space-y-3">
            {data.productionChanges.length === 0 ? (
              <p className="text-sm text-muted-foreground">No production changes recorded.</p>
            ) : (
              data.productionChanges.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-[var(--candid-yellow)]/30 bg-yellow-50/20 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{item.item_name}</p>
                    <span className="text-xs text-muted-foreground">
                      {MANIFEST_SOURCE_TYPE_LABELS[item.source_type]}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {MANIFEST_BILLING_STATUS_LABELS[item.billing_status]}
                    {item.customer_change_reason
                      ? ` · Cancelled: ${item.customer_change_reason}`
                      : ""}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="portal-surface rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Final invoice lines</h2>
          <div className="mt-4 space-y-4">
            {data.finalLines.length === 0 ? (
              <p className="text-sm text-muted-foreground">No billable invoice lines yet.</p>
            ) : (
              data.finalLines.map((line) => (
                <div key={line.id} className="rounded-lg border border-border p-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2 md:col-span-2">
                      <Label>Description</Label>
                      <Input
                        defaultValue={line.description}
                        onBlur={(e) => {
                          if (e.target.value !== line.description) {
                            void updateLine(line.id, { description: e.target.value });
                          }
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Quantity</Label>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        defaultValue={line.quantity}
                        disabled={busyItemId === line.id}
                        onBlur={(e) => {
                          if (Number(e.target.value) !== line.quantity) {
                            void updateLine(line.id, { quantity: Number(e.target.value) });
                          }
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Unit</Label>
                      <Input
                        defaultValue={line.unit ?? "each"}
                        disabled={busyItemId === line.id}
                        onBlur={(e) => {
                          if (e.target.value !== (line.unit ?? "each")) {
                            void updateLine(line.id, { unit: e.target.value });
                          }
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Unit price</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        defaultValue={line.unit_price ?? ""}
                        disabled={busyItemId === line.id}
                        onBlur={(e) => {
                          const next =
                            e.target.value === "" ? null : Number(e.target.value);
                          if (next !== line.unit_price) {
                            void updateLine(line.id, { unitPrice: next });
                          }
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>VAT %</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.1"
                        defaultValue={line.tax_rate}
                        disabled={busyItemId === line.id}
                        onBlur={(e) => {
                          if (Number(e.target.value) !== line.tax_rate) {
                            void updateLine(line.id, { taxRate: Number(e.target.value) });
                          }
                        }}
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <p className="text-muted-foreground">
                      Source: {PRICING_SOURCE_LABELS[line.pricing_source]} ·{" "}
                      {MANIFEST_BILLING_STATUS_LABELS[line.billing_status]}
                    </p>
                    <p className="font-medium">{formatGbp(line.line_total)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="portal-surface rounded-xl border border-dashed border-border bg-muted/20 p-6">
          <h2 className="text-lg font-semibold">Xero payload preview</h2>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-muted/40 p-4 text-xs text-muted-foreground">
            {JSON.stringify(xeroPreview, null, 2)}
          </pre>
          <Button type="button" className="mt-4" disabled title="Xero integration is not configured yet.">
            Push to Xero
          </Button>
          <p className="mt-2 text-sm text-muted-foreground">
            Xero integration is not configured yet.
          </p>
        </section>
      </div>

      <aside className="xl:sticky xl:top-24 xl:self-start">
        <div className="portal-surface rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Review totals</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="font-medium">{formatGbp(data.draft.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">VAT</dt>
              <dd className="font-medium">{formatGbp(data.draft.tax_total)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-3 text-base">
              <dt className="font-semibold">Total</dt>
              <dd className="font-semibold">{formatGbp(data.draft.total)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-muted-foreground">
            Unpriced items: {data.unpricedCount}
          </p>
          <div className="mt-5 space-y-2">
            <Button
              type="button"
              className="w-full"
              disabled={!data.canApprove || isApproving || data.draft.status === "approved"}
              onClick={() => void approveDraft()}
            >
              {data.draft.status === "approved" ? "Approved" : "Approve invoice draft"}
            </Button>
            <Link href={`/admin/jobs/${jobId}`} className="block">
              <Button type="button" variant="outline" className="w-full">
                Back to job
              </Button>
            </Link>
          </div>
        </div>
      </aside>
    </div>
  );
}
