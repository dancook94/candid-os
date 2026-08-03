"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PRICING_SOURCE_LABELS,
} from "@/lib/invoice/constants";
import { INVOICE_DISPLAY_STATUS_LABELS } from "@/lib/invoice/display-status";
import {
  calculateInvoiceDraftTotals,
  calculateInvoiceLineTotals,
  calculatePersistedLineNetTotal,
  invoiceLineNeedsPricing,
  normalizeInvoiceItemNumericFields,
  parseMoneyValue,
  parseQuantityValue,
  resolveBillingStatusAfterPricing,
} from "@/lib/invoice/money";
import { buildXeroLineDescription, formatManifestPreviewDescription } from "@/lib/invoice/line-text";
import type { InvoiceLineView, InvoiceReviewData, XeroPayloadPreview } from "@/lib/invoice/types";
import {
  MANIFEST_BILLING_STATUS_LABELS,
  MANIFEST_SOURCE_TYPE_LABELS,
} from "@/lib/manifest/constants";
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

type LineDraft = {
  itemName: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  taxRate: string;
};

type LiveLineSnapshot = {
  id: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  billingStatus: InvoiceLineView["billing_status"];
  deletedAt: string | null;
};

function buildLiveLineSnapshot(line: InvoiceLineView): LiveLineSnapshot {
  return {
    id: line.id,
    quantity: String(line.quantity),
    unitPrice: line.unit_price === null ? "" : String(line.unit_price),
    taxRate: String(line.tax_rate),
    billingStatus: line.billing_status,
    deletedAt: line.deleted_at,
  };
}

function buildLineDraft(line: InvoiceLineView): LineDraft {
  return {
    itemName: line.item_name,
    description: line.description ?? "",
    quantity: String(line.quantity),
    unit: line.unit ?? "each",
    unitPrice: line.unit_price === null ? "" : String(line.unit_price),
    taxRate: String(line.tax_rate),
  };
}

function InvoiceLineEditor({
  jobId,
  line,
  onSaved,
  onDraftChange,
  readOnly = false,
}: {
  jobId: string;
  line: InvoiceLineView;
  onSaved: (message: string) => void;
  onDraftChange?: (lineId: string, snapshot: LiveLineSnapshot) => void;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState<LineDraft>(() => buildLineDraft(line));
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState("");

  const liveTotals = useMemo(
    () =>
      calculateInvoiceLineTotals({
        quantity: draft.quantity,
        unitPrice: draft.unitPrice === "" ? null : draft.unitPrice,
        taxRate: draft.taxRate,
      }),
    [draft.quantity, draft.unitPrice, draft.taxRate]
  );

  function updateDraft(next: LineDraft) {
    setDraft(next);
    const unitPrice =
      next.unitPrice === "" ? null : parseMoneyValue(next.unitPrice);
    onDraftChange?.(line.id, {
      id: line.id,
      quantity: next.quantity,
      unitPrice: next.unitPrice,
      taxRate: next.taxRate,
      billingStatus: resolveBillingStatusAfterPricing(
        line.billing_status,
        unitPrice
      ) as InvoiceLineView["billing_status"],
      deletedAt: line.deleted_at,
    });
  }

  async function saveLine() {
    setIsSaving(true);
    setError("");

    try {
      const response = await fetch(`/api/admin/jobs/${jobId}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_item",
          itemId: line.id,
          itemName: draft.itemName,
          description: draft.description,
          quantity: Number(draft.quantity),
          unit: draft.unit,
          unitPrice: draft.unitPrice === "" ? null : Number(draft.unitPrice),
          taxRate: Number(draft.taxRate),
          manuallyEdited: true,
        }),
      });

      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to save invoice line.");
      }

      onSaved("Invoice changes saved.");
      window.location.reload();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save invoice line."
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function resetFromSource() {
    setIsResetting(true);
    setError("");

    try {
      const response = await fetch(`/api/admin/jobs/${jobId}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset_from_source",
          itemId: line.id,
        }),
      });

      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to reset invoice line.");
      }

      onSaved("Invoice line reset from source.");
      window.location.reload();
    } catch (resetError) {
      setError(
        resetError instanceof Error ? resetError.message : "Unable to reset invoice line."
      );
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Source: {line.sourceLabel}
          </p>
          {line.manually_edited ? (
            <p className="mt-1 text-xs text-amber-700">Manually edited</p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-base font-semibold text-foreground">
            {formatGbp(liveTotals.grossTotal)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Net {formatGbp(liveTotals.netTotal)} · VAT {formatGbp(liveTotals.vatAmount)}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`item-name-${line.id}`}>Item title</Label>
          <Input
            id={`item-name-${line.id}`}
            value={draft.itemName}
            disabled={readOnly}
            onChange={(event) =>
              updateDraft({ ...draft, itemName: event.target.value })
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`description-${line.id}`}>Description</Label>
          <Textarea
            id={`description-${line.id}`}
            value={draft.description}
            disabled={readOnly}
            onChange={(event) =>
              updateDraft({ ...draft, description: event.target.value })
            }
            rows={6}
            className="min-h-[9rem] resize-y"
            placeholder="Full invoice description for Xero and customer-facing records"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor={`quantity-${line.id}`}>Quantity</Label>
            <Input
              id={`quantity-${line.id}`}
              type="number"
              min="0"
              step="any"
              value={draft.quantity}
              disabled={readOnly}
              onChange={(event) =>
                updateDraft({ ...draft, quantity: event.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`unit-${line.id}`}>Unit</Label>
            <Input
              id={`unit-${line.id}`}
              value={draft.unit}
              disabled={readOnly}
              onChange={(event) =>
                updateDraft({ ...draft, unit: event.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`unit-price-${line.id}`}>Unit price</Label>
            <Input
              id={`unit-price-${line.id}`}
              type="number"
              min="0"
              step="0.01"
              value={draft.unitPrice}
              disabled={readOnly}
              onChange={(event) =>
                updateDraft({ ...draft, unitPrice: event.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`tax-rate-${line.id}`}>VAT %</Label>
            <Input
              id={`tax-rate-${line.id}`}
              type="number"
              min="0"
              step="0.1"
              value={draft.taxRate}
              disabled={readOnly}
              onChange={(event) =>
                updateDraft({ ...draft, taxRate: event.target.value })
              }
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm">
        <p className="text-muted-foreground">
          Pricing: {PRICING_SOURCE_LABELS[line.pricing_source]} ·{" "}
          {MANIFEST_BILLING_STATUS_LABELS[line.billing_status]}
        </p>
        <div className="flex flex-wrap gap-2">
          {!readOnly && line.canResetFromSource ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSaving || isResetting}
              onClick={() => void resetFromSource()}
            >
              Reset from source
            </Button>
          ) : null}
          {!readOnly ? (
            <Button
              type="button"
              size="sm"
              disabled={isSaving || isResetting || !draft.itemName.trim()}
              onClick={() => void saveLine()}
            >
              {isSaving ? "Saving…" : "Save changes"}
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

export function InvoiceReviewClient({
  jobId,
  jobReference,
  companyName,
  quoteLabel,
  opportunityTitle,
  initialData,
  xeroPreview,
}: InvoiceReviewClientProps) {
  const [data] = useState(initialData);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isApproving, setIsApproving] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [showReopenDialog, setShowReopenDialog] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  const [liveLineSnapshots, setLiveLineSnapshots] = useState<
    Record<string, LiveLineSnapshot>
  >({});

  const effectiveInvoiceItems = useMemo(() => {
    if (data.schemaMissing || data.error) {
      return [];
    }

    return data.finalLines.map((line) => {
      const live = liveLineSnapshots[line.id];
      const quantity = parseQuantityValue(live?.quantity ?? line.quantity);
      const unitPrice = live
        ? live.unitPrice === ""
          ? null
          : parseMoneyValue(live.unitPrice)
        : line.unit_price;
      const taxRate = parseMoneyValue(live?.taxRate ?? line.tax_rate) ?? 0;
      const billingStatus = resolveBillingStatusAfterPricing(
        live?.billingStatus ?? line.billing_status,
        unitPrice
      ) as InvoiceLineView["billing_status"];
      const lineTotal = calculatePersistedLineNetTotal({
        quantity,
        unitPrice,
        billingStatus,
      });

      return normalizeInvoiceItemNumericFields({
        ...line,
        quantity,
        unit_price: unitPrice,
        tax_rate: taxRate,
        billing_status: billingStatus,
        line_total: lineTotal,
      });
    });
  }, [data, liveLineSnapshots]);

  const liveDraftTotals = useMemo(
    () => calculateInvoiceDraftTotals(effectiveInvoiceItems),
    [effectiveInvoiceItems]
  );

  const liveUnpricedCount = useMemo(
    () => effectiveInvoiceItems.filter(invoiceLineNeedsPricing).length,
    [effectiveInvoiceItems]
  );

  const displayTotals = data.isApproved
    ? {
        subtotal: data.draft.subtotal,
        tax_total: data.draft.tax_total,
        total: data.draft.total,
      }
    : liveDraftTotals;

  const displayUnpricedCount = data.isApproved ? data.unpricedCount : liveUnpricedCount;

  function handleLineDraftChange(lineId: string, snapshot: LiveLineSnapshot) {
    setLiveLineSnapshots((current) => ({ ...current, [lineId]: snapshot }));
  }

  const previewFromDrafts = useMemo(() => {
    if (data.schemaMissing || data.error) {
      return xeroPreview;
    }

    return {
      ...xeroPreview,
      lineItems: data.finalLines.map((line) => ({
        itemName: line.item_name,
        description: buildXeroLineDescription(line),
        quantity: line.quantity,
        unitAmount: line.unit_price ?? 0,
        taxRate: line.tax_rate,
        lineTotal: line.line_total,
      })),
    };
  }, [data, xeroPreview]);

  async function approveDraft() {
    setIsApproving(true);
    setError("");
    setSuccess("");

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

  async function reopenDraft() {
    setIsReopening(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(`/api/admin/jobs/${jobId}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reopen",
          draftId: data.draft.id,
          reason: reopenReason,
        }),
      });

      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to reopen invoice draft.");
      }

      window.location.reload();
    } catch (reopenError) {
      setError(
        reopenError instanceof Error
          ? reopenError.message
          : "Unable to reopen invoice draft."
      );
    } finally {
      setIsReopening(false);
    }
  }

  if (data.schemaMissing) {
    return (
      <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-6 text-sm text-amber-900">
        Invoice draft tables are not configured yet. Apply the manifest and invoice migrations in Supabase.
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
                Status: {INVOICE_DISPLAY_STATUS_LABELS[data.displayStatus]}
              </p>
              {data.isApproved ? (
                <p className="mt-1 text-emerald-700">Approved — ready for Xero</p>
              ) : null}
            </div>
          </div>
        </div>

        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {success ? (
          <p className="rounded-lg border border-emerald-300/40 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {success}
          </p>
        ) : null}

        {data.productionChangedAfterApproval ? (
          <p className="rounded-lg border border-amber-300/50 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Production changed after invoice approval. Reopen the draft before changing commercial lines.
          </p>
        ) : null}

        {displayUnpricedCount > 0 ? (
          <p className="rounded-lg border border-amber-300/50 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {displayUnpricedCount} billable item(s) still require pricing before approval.
          </p>
        ) : null}

        <section className="portal-surface rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Originally quoted</h2>
          <div className="mt-4 space-y-3">
            {data.quotedItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No quoted manifest items.</p>
            ) : (
              data.quotedItems.map((item) => (
                <div key={item.id} className="rounded-lg border border-border/70 p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{item.item_name}</p>
                    <span className="text-xs text-muted-foreground">
                      {MANIFEST_SOURCE_TYPE_LABELS[item.source_type]}
                    </span>
                  </div>
                  {item.description ? (
                    <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                      {item.description}
                    </p>
                  ) : null}
                  <p className="mt-2 text-muted-foreground">
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
                  className="rounded-lg border border-[var(--candid-yellow)]/30 bg-yellow-50/20 p-4 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{item.item_name}</p>
                    <span className="text-xs text-muted-foreground">
                      {MANIFEST_SOURCE_TYPE_LABELS[item.source_type]}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                    {formatManifestPreviewDescription(item)}
                  </p>
                  <p className="mt-2 text-muted-foreground">
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

        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Final invoice lines</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Edit the title and full description for each billable line before approving or pushing to Xero.
            </p>
          </div>

          {data.finalLines.length === 0 ? (
            <div className="portal-surface rounded-xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
              No billable invoice lines yet.
            </div>
          ) : (
            data.finalLines.map((line) => (
              <InvoiceLineEditor
                key={line.id}
                jobId={jobId}
                line={line}
                onSaved={setSuccess}
                onDraftChange={handleLineDraftChange}
                readOnly={data.isApproved}
              />
            ))
          )}
        </section>

        <section className="portal-surface rounded-xl border border-dashed border-border bg-muted/20 p-6">
          <h2 className="text-lg font-semibold">Xero payload preview</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Line descriptions combine the saved title and full description.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-muted/40 p-4 text-xs text-muted-foreground">
            {JSON.stringify(previewFromDrafts, null, 2)}
          </pre>
          <Button type="button" className="mt-4" disabled title="Xero integration is not configured yet.">
            Push to Xero
          </Button>
          <p className="mt-2 text-sm text-muted-foreground">
            Xero integration is not configured yet.
          </p>
        </section>
      </div>

      <aside className="xl:sticky xl:top-24 xl:self-start space-y-4">
        <div className="portal-surface rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Review totals</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="font-medium">{formatGbp(displayTotals.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">VAT</dt>
              <dd className="font-medium">{formatGbp(displayTotals.tax_total)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-3 text-base">
              <dt className="font-semibold">Total</dt>
              <dd className="font-semibold">{formatGbp(displayTotals.total)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-muted-foreground">
            Unpriced items: {displayUnpricedCount}
          </p>
        </div>

        <div className="portal-surface rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Ready for approval</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {data.approvalReadiness.checklist.map((item) => (
              <li key={item.id} className="flex items-start gap-2">
                <span
                  className={
                    item.passed ? "text-emerald-600" : "text-amber-700"
                  }
                >
                  {item.passed ? "✓" : "○"}
                </span>
                <div>
                  <p className={item.passed ? "text-foreground" : "text-amber-900"}>
                    {item.label}
                  </p>
                  {item.detail ? (
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          {!data.canApprove && data.approvalReadiness.blockingReasons.length > 0 ? (
            <div className="mt-4 rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              <p className="font-medium">Approval blocked</p>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {data.approvalReadiness.blockingReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-5 space-y-2">
            {data.isApproved ? (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setShowReopenDialog(true)}
              >
                Reopen draft
              </Button>
            ) : (
              <Button
                type="button"
                className="w-full"
                disabled={!data.canApprove || isApproving}
                onClick={() => void approveDraft()}
              >
                {isApproving ? "Approving…" : "Approve draft invoice"}
              </Button>
            )}
            <Link href={`/admin/jobs/${jobId}`} className="block">
              <Button type="button" variant="outline" className="w-full">
                Back to job
              </Button>
            </Link>
            <Link href="/admin/invoices" className="block">
              <Button type="button" variant="ghost" className="w-full">
                All invoices
              </Button>
            </Link>
          </div>
        </div>
      </aside>

      {showReopenDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="portal-surface w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
            <h3 className="text-lg font-semibold">Reopen invoice draft</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Explain why this approved draft needs further commercial changes.
            </p>
            <div className="mt-4 space-y-2">
              <Label htmlFor="reopen-reason">Reason</Label>
              <Textarea
                id="reopen-reason"
                value={reopenReason}
                onChange={(event) => setReopenReason(event.target.value)}
                rows={4}
                required
              />
            </div>
            <div className="mt-5 flex gap-3">
              <Button
                type="button"
                disabled={isReopening || !reopenReason.trim()}
                onClick={() => void reopenDraft()}
              >
                {isReopening ? "Reopening…" : "Reopen draft"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isReopening}
                onClick={() => setShowReopenDialog(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
