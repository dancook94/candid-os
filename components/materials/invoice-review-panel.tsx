"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  formatGbp,
  formatSignedGbp,
  formatSignedPercent,
} from "@/lib/materials/invoices/money";
import { priceApprovalConsequence } from "@/lib/materials/invoices/price-change";
import { PURCHASE_UNIT_LABELS } from "@/lib/materials/units";
import {
  REVIEW_STATUS_LABELS,
  type InvoiceReviewStatus,
} from "@/lib/materials/invoices/model";
import type { InvoiceDetailLine } from "@/lib/materials/invoices/queries";

type ProductOption = { id: string; label: string };
type SupplierOption = { id: string; name: string };

const EXCEPTION_STATUSES = new Set<InvoiceReviewStatus>([
  "price_change",
  "needs_review",
  "unmatched",
  "extraction_error",
  "query",
]);

export function InvoiceSupplierForm({
  invoiceId,
  supplierId,
  suppliers,
}: {
  invoiceId: string;
  supplierId: string | null;
  suppliers: SupplierOption[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSupplierId = String(new FormData(event.currentTarget).get("supplierId") ?? "");
    setPending(true);
    setError(null);
    const response = await fetch(`/api/admin/materials/invoices/${invoiceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supplierId: nextSupplierId }),
    });
    const payload = await response.json().catch(() => null);
    setPending(false);

    if (!response.ok) {
      setError(payload?.error ?? "The supplier could not be saved.");
      return;
    }

    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1">
        <Label htmlFor="invoice-supplier">Supplier</Label>
        <Select
          id="invoice-supplier"
          name="supplierId"
          defaultValue={supplierId ?? ""}
          className="mt-2"
          required
        >
          <option value="" disabled>
            Choose the supplier
          </option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Save supplier"}
      </Button>
      {error ? <p className="text-sm text-red-700 sm:basis-full">{error}</p> : null}
    </form>
  );
}

export function InvoiceLineList({
  invoiceId,
  lines,
  products,
  supplierChosen,
  supplierName,
  invoiceDate,
}: {
  invoiceId: string;
  lines: InvoiceDetailLine[];
  products: ProductOption[];
  supplierChosen: boolean;
  supplierName: string;
  invoiceDate: string | null;
}) {
  const exceptions = lines.filter((line) => EXCEPTION_STATUSES.has(line.reviewStatus));
  const settled = lines.filter((line) => !EXCEPTION_STATUSES.has(line.reviewStatus));

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold">Exceptions</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {exceptions.length === 0
            ? "No lines need a decision."
            : `${exceptions.length} line${exceptions.length === 1 ? "" : "s"} need a decision.`}
        </p>
        <div className="mt-4 space-y-4">
          {exceptions.map((line) => (
            <InvoiceLineCard
              key={line.id}
              invoiceId={invoiceId}
              line={line}
              products={products}
              supplierChosen={supplierChosen}
              supplierName={supplierName}
              invoiceDate={invoiceDate}
            />
          ))}
        </div>
      </section>

      {settled.length > 0 ? (
        <details className="rounded-2xl border border-border/70 bg-card">
          <summary className="cursor-pointer px-5 py-4 text-sm font-medium">
            {settled.filter((line) => line.reviewStatus === "processed").length} matched,{" "}
            {settled.filter((line) => line.reviewStatus === "ignored").length} ignored
          </summary>
          <div className="space-y-3 border-t border-border/70 px-5 py-4">
            {settled.map((line) => (
              <SettledLine key={line.id} line={line} />
            ))}
          </div>
        </details>
      ) : null}

      <AddLineForm invoiceId={invoiceId} />
    </div>
  );
}

function InvoiceLineCard({
  invoiceId,
  line,
  products,
  supplierChosen,
  supplierName,
  invoiceDate,
}: {
  invoiceId: string;
  line: InvoiceDetailLine;
  products: ProductOption[];
  supplierChosen: boolean;
  supplierName: string;
  invoiceDate: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const effective = {
    description: line.reviewedDescription ?? line.rawDescription,
    sku: line.reviewedSupplierSku ?? line.rawSupplierSku ?? "",
    quantity: line.reviewedQuantity ?? line.rawQuantity ?? "",
    unit: line.reviewedUnit ?? line.rawUnit ?? "",
    unitPrice: line.reviewedUnitPrice ?? line.rawUnitPrice ?? "",
    lineTotal: line.reviewedLineTotal ?? line.rawLineTotal ?? "",
    note: line.internalNote ?? "",
    productId: line.matchedProductId ?? "",
  };

  async function send(body: Record<string, unknown>) {
    setPending(true);
    setError(null);
    const response = await fetch(
      `/api/admin/materials/invoices/${invoiceId}/lines/${line.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    const payload = await response.json().catch(() => null);
    setPending(false);

    if (!response.ok) {
      setError(payload?.error ?? "The line could not be saved.");
      return;
    }

    router.refresh();
  }

  function readForm(form: HTMLFormElement) {
    const data = new FormData(form);
    return {
      description: String(data.get("description") ?? ""),
      sku: String(data.get("sku") ?? ""),
      quantity: String(data.get("quantity") ?? ""),
      unit: String(data.get("unit") ?? ""),
      unitPrice: String(data.get("unitPrice") ?? ""),
      lineTotal: String(data.get("lineTotal") ?? ""),
      note: String(data.get("note") ?? ""),
      productId: String(data.get("productId") ?? ""),
    };
  }

  return (
    <article className="rounded-2xl border border-border/70 bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-medium">Line {line.lineNumber}</h3>
        <StatusPill status={line.reviewStatus} />
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Original: {line.rawDescription}
        {line.rawSupplierSku ? ` · SKU ${line.rawSupplierSku}` : ""}
      </p>
      {line.mathsWarning ? (
        <p className="mt-2 text-sm text-amber-800">{line.mathsWarning}</p>
      ) : null}
      {line.reviewStatus === "price_change" ? (
        <PriceChangePanel
          invoiceId={invoiceId}
          line={line}
          supplierName={supplierName}
          invoiceDate={invoiceDate}
          pending={pending}
          onPending={setPending}
          onError={setError}
        />
      ) : null}
      {line.decisionSummary && line.reviewStatus === "query" ? (
        <p className="mt-3 text-sm">{line.decisionSummary}</p>
      ) : null}
      {line.matchedProductLabel ? (
        <p className="mt-2 text-sm">
          Suggested product: {line.matchedProductLabel}
          {line.matchConfidence ? ` · ${line.matchConfidence} confidence` : ""}
        </p>
      ) : null}
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send({ action: "correct", ...readForm(event.currentTarget) });
        }}
      >
        <Field id={`description-${line.id}`} label="Description" name="description" defaultValue={effective.description} />
        <Field id={`sku-${line.id}`} label="SKU" name="sku" defaultValue={effective.sku} />
        <Field id={`quantity-${line.id}`} label="Quantity" name="quantity" defaultValue={effective.quantity} />
        <Field id={`unit-${line.id}`} label="Unit" name="unit" defaultValue={effective.unit} />
        <Field id={`price-${line.id}`} label="Unit price" name="unitPrice" defaultValue={effective.unitPrice} />
        <Field id={`total-${line.id}`} label="Line total" name="lineTotal" defaultValue={effective.lineTotal} />
        <div className="sm:col-span-2">
          <Label htmlFor={`product-${line.id}`}>Existing supplier product</Label>
          <Select
            id={`product-${line.id}`}
            name="productId"
            defaultValue={effective.productId}
            className="mt-2"
            disabled={!supplierChosen}
          >
            <option value="">No product selected</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`note-${line.id}`}>Internal note</Label>
          <Input id={`note-${line.id}`} name="note" defaultValue={effective.note} className="mt-2" />
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" variant="outline" disabled={pending}>
            Save correction
          </Button>
          <Button
            type="button"
            disabled={pending || !supplierChosen}
            onClick={(event) => {
              const form = event.currentTarget.form;
              if (!form) return;
              void send({ action: "confirm_match", ...readForm(form) });
            }}
          >
            Confirm match and remember description
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={(event) => {
              const form = event.currentTarget.form;
              if (!form) return;
              void send({ action: "ignore", remember: false, ...readForm(form) });
            }}
          >
            Ignore
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending || !supplierChosen}
            onClick={(event) => {
              const form = event.currentTarget.form;
              if (!form) return;
              void send({ action: "ignore", remember: true, ...readForm(form) });
            }}
          >
            Ignore and remember
          </Button>
          {line.reviewStatus === "price_change" && line.comparison && line.comparison.difference !== 0 ? null : (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={(event) => {
                const form = event.currentTarget.form;
                if (!form) return;
                void send({ action: "query", ...readForm(form) });
              }}
            >
              Query
            </Button>
          )}
          {supplierChosen && (line.reviewStatus === "needs_review" || line.reviewStatus === "unmatched") ? (
            <Link href={`/admin/materials/invoices/${invoiceId}/lines/${line.id}/new-material`}>
              <Button type="button" variant="outline">
                Create new material
              </Button>
            </Link>
          ) : (
            <Button type="button" variant="outline" disabled>
              Create new material
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          Create new material is for a line that is not already a product. A price change is
          approved, kept, or queried from the price panel. Confirm match does not change a price.
        </p>
        {error ? <p className="text-sm text-red-700 sm:col-span-2">{error}</p> : null}
      </form>
    </article>
  );
}

function SettledLine({ line }: { line: InvoiceDetailLine }) {
  return (
    <div className="text-sm">
      <p>
        <span className="font-medium">Line {line.lineNumber}.</span> {line.rawDescription}
        {line.comparison ? ` · ${formatGbp(line.comparison.invoicePrice)}` : ""}
        {line.matchedProductLabel ? ` · ${line.matchedProductLabel}` : ""}
        {" · "}
        {REVIEW_STATUS_LABELS[line.reviewStatus]}
      </p>
      {line.decisionSummary ? (
        <p className="mt-1 text-muted-foreground">{line.decisionSummary}</p>
      ) : null}
    </div>
  );
}

function PriceChangePanel({
  invoiceId,
  line,
  supplierName,
  invoiceDate,
  pending,
  onPending,
  onError,
}: {
  invoiceId: string;
  line: InvoiceDetailLine;
  supplierName: string;
  invoiceDate: string | null;
  pending: boolean;
  onPending: (pending: boolean) => void;
  onError: (error: string | null) => void;
}) {
  const router = useRouter();
  const comparison = line.comparison;
  const consequence =
    comparison?.currentEffectiveDate
      ? priceApprovalConsequence({
          invoiceDate,
          currentEffectiveDate: comparison.currentEffectiveDate,
          invoicePrice: comparison.invoicePrice,
          currentPrice: comparison.currentPrice,
        })
      : null;
  const comparable = Boolean(
    comparison?.currentPriceId && line.matchedProductId && comparison.difference !== 0
  );
  const canApprove = comparable && consequence?.effect !== "missing_date";

  async function decide(decision: "approve" | "keep" | "query") {
    if (!comparison?.currentPriceId || !line.matchedProductId) {
      return;
    }

    const note = document.querySelector<HTMLInputElement>(`#note-${line.id}`)?.value ?? "";
    onPending(true);
    onError(null);
    const response = await fetch(
      `/api/admin/materials/invoices/${invoiceId}/lines/${line.id}/price`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          expectedProductId: line.matchedProductId,
          expectedPriceId: comparison.currentPriceId,
          expectedInvoicePrice: comparison.invoicePrice,
          note,
        }),
      }
    );
    const payload = await response.json().catch(() => null);
    onPending(false);

    if (!response.ok) {
      onError(payload?.error ?? "The price decision could not be saved.");
      router.refresh();
      return;
    }

    router.refresh();
  }

  return (
    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <dl className="grid gap-2 sm:grid-cols-2">
        <PriceFact label="Material" value={line.materialName || "Not matched"} />
        <PriceFact label="Supplier product" value={line.productDescription || "Not matched"} />
        <PriceFact label="Supplier" value={supplierName || "Not chosen"} />
        <PriceFact label="Invoice date" value={invoiceDate || "Not found"} />
        <PriceFact
          label="Current approved price"
          value={
            comparison
              ? `${formatGbp(comparison.currentPrice)} per ${PURCHASE_UNIT_LABELS[comparison.priceUnit].toLowerCase()}`
              : "Not comparable"
          }
        />
        <PriceFact
          label="Current price effective date"
          value={comparison?.currentEffectiveDate || "Not found"}
        />
        <PriceFact
          label="Invoice price ex-VAT"
          value={comparison ? `${formatGbp(comparison.invoicePrice)} per ${PURCHASE_UNIT_LABELS[comparison.priceUnit].toLowerCase()}` : "Not comparable"}
        />
        <PriceFact
          label="Difference"
          value={
            comparison
              ? `${formatSignedGbp(comparison.difference)} · ${formatSignedPercent(comparison.percent)}`
              : "Not comparable"
          }
        />
        <PriceFact
          label="Direction"
          value={comparison ? (comparison.difference > 0 ? "Increase" : "Decrease") : "Not comparable"}
        />
        <PriceFact
          label="Match"
          value={`${line.matchConfidence ?? "unknown"} confidence · ${line.matchMethod ?? "unknown"} match`}
        />
      </dl>
      {comparison && comparison.difference === 0 ? (
        <p className="mt-3 font-medium">
          This invoice price now matches the current approved price. Save the line to mark it
          matched. No new price is created.
        </p>
      ) : consequence ? <p className="mt-3 font-medium">{consequence.message}</p> : (
        <p className="mt-3 font-medium">
          This invoice price cannot be compared with the current approved price. Check the unit
          before approving anything.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" disabled={pending || !canApprove} onClick={() => void decide("approve")}>
          Approve new price
        </Button>
        <Button type="button" variant="outline" disabled={pending || !comparable} onClick={() => void decide("keep")}>
          Keep current price
        </Button>
        <Button type="button" variant="outline" disabled={pending || !comparable} onClick={() => void decide("query")}>
          Query
        </Button>
      </div>
    </div>
  );
}

function PriceFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-amber-800">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function AddLineForm({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const response = await fetch(`/api/admin/materials/invoices/${invoiceId}/lines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: String(data.get("description") ?? ""),
        sku: String(data.get("sku") ?? ""),
        quantity: String(data.get("quantity") ?? ""),
        unit: String(data.get("unit") ?? ""),
        unitPrice: String(data.get("unitPrice") ?? ""),
        lineTotal: String(data.get("lineTotal") ?? ""),
      }),
    });
    const payload = await response.json().catch(() => null);
    setPending(false);

    if (!response.ok) {
      setError(payload?.error ?? "The line could not be added.");
      return;
    }

    event.currentTarget.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-dashed border-border p-5">
      <h2 className="text-lg font-semibold">Add a line</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Use this when the file has no text layer, or a line was missed. The values you type are
        stored as the original extracted line.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field id="add-description" label="Description" name="description" defaultValue="" />
        <Field id="add-sku" label="SKU" name="sku" defaultValue="" />
        <Field id="add-quantity" label="Quantity" name="quantity" defaultValue="" />
        <Field id="add-unit" label="Unit" name="unit" defaultValue="" />
        <Field id="add-price" label="Unit price" name="unitPrice" defaultValue="" />
        <Field id="add-total" label="Line total" name="lineTotal" defaultValue="" />
      </div>
      <Button type="submit" className="mt-4" variant="outline" disabled={pending}>
        {pending ? "Adding…" : "Add line"}
      </Button>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </form>
  );
}

export function InvoiceReprocessButton({
  invoiceId,
  blockedReason,
}: {
  invoiceId: string;
  blockedReason?: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function reprocess() {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/admin/materials/invoices/${invoiceId}/reprocess`, {
      method: "POST",
    });
    const payload = await response.json().catch(() => null);
    setPending(false);

    if (!response.ok) {
      setError(payload?.error ?? "The invoice could not be read again.");
      return;
    }

    router.refresh();
  }

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        disabled={pending || Boolean(blockedReason)}
        onClick={() => void reprocess()}
      >
        {pending ? "Reading again…" : "Re-read stored invoice"}
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">
        {blockedReason ??
          "Rebuilds the extraction from the original file. Approved prices stay unchanged."}
      </p>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

function Field({
  id,
  label,
  name,
  defaultValue,
}: {
  id: string;
  label: string;
  name: string;
  defaultValue: string | number;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} defaultValue={defaultValue} className="mt-2" />
    </div>
  );
}

function StatusPill({ status }: { status: InvoiceReviewStatus }) {
  return (
    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-600/15">
      {REVIEW_STATUS_LABELS[status]}
    </span>
  );
}
