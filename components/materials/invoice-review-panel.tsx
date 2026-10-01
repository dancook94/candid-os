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
}: {
  invoiceId: string;
  lines: InvoiceDetailLine[];
  products: ProductOption[];
  supplierChosen: boolean;
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
}: {
  invoiceId: string;
  line: InvoiceDetailLine;
  products: ProductOption[];
  supplierChosen: boolean;
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
      {line.comparison && line.reviewStatus === "price_change" ? (
        <p className="mt-3 text-sm">
          Current {formatGbp(line.comparison.currentPrice)} · Invoice{" "}
          {formatGbp(line.comparison.invoicePrice)} ·{" "}
          {formatSignedGbp(line.comparison.difference)} ·{" "}
          {formatSignedPercent(line.comparison.percent)}
        </p>
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
          Create new material is for a line that is not already a product. A price change on an
          existing product is not approved from this screen.
        </p>
        {error ? <p className="text-sm text-red-700 sm:col-span-2">{error}</p> : null}
      </form>
    </article>
  );
}

function SettledLine({ line }: { line: InvoiceDetailLine }) {
  return (
    <p className="text-sm">
      <span className="font-medium">Line {line.lineNumber}.</span> {line.rawDescription}
      {line.comparison ? ` · ${formatGbp(line.comparison.invoicePrice)}` : ""}
      {line.matchedProductLabel ? ` · ${line.matchedProductLabel}` : ""}
      {" · "}
      {REVIEW_STATUS_LABELS[line.reviewStatus]}
    </p>
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

export function InvoiceReprocessButton({ invoiceId }: { invoiceId: string }) {
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
      <Button type="button" variant="outline" disabled={pending} onClick={() => void reprocess()}>
        {pending ? "Reading again…" : "Re-read stored invoice"}
      </Button>
      <p className="mt-2 text-xs text-muted-foreground">
        Rebuilds the extraction from the original file. Approved prices stay unchanged.
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
