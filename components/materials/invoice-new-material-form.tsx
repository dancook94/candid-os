"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { InvoiceMaterialDraft } from "@/lib/materials/invoices/new-material";
import { PURCHASE_UNIT_LABELS, PURCHASE_UNITS } from "@/lib/materials/units";

export function InvoiceNewMaterialForm({
  invoiceId,
  lineId,
  supplierName,
  effectiveDate,
  proposal,
}: {
  invoiceId: string;
  lineId: string;
  supplierName: string;
  effectiveDate: string;
  proposal: InvoiceMaterialDraft;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const response = await fetch(
      `/api/admin/materials/invoices/${invoiceId}/lines/${lineId}/material`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          category: form.get("category"),
          thicknessMm: form.get("thicknessMm"),
          colour: form.get("colour"),
          finish: form.get("finish"),
          purchaseUnit: form.get("purchaseUnit"),
          purchaseWidthMm: form.get("purchaseWidthMm"),
          purchaseHeightMm: form.get("purchaseHeightMm"),
          purchaseLengthMm: form.get("purchaseLengthMm"),
          supplierDescription: form.get("supplierDescription"),
          supplierSku: form.get("supplierSku"),
          price: form.get("price"),
          effectiveDate: form.get("effectiveDate"),
          preferred: form.get("preferred") === "on",
        }),
      }
    );
    const payload = await response.json().catch(() => null);
    setPending(false);

    if (!response.ok) {
      setError(payload?.error ?? "The material could not be created.");
      return;
    }

    router.push(`/admin/materials/invoices/${invoiceId}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-5 md:grid-cols-2">
      <Field id="name" label="Canonical material name" name="name" defaultValue={proposal.name} className="md:col-span-2" />
      <Field id="category" label="Category" name="category" defaultValue={proposal.category ?? ""} />
      <div>
        <Label htmlFor="purchaseUnit">Purchase unit</Label>
        <Select id="purchaseUnit" name="purchaseUnit" defaultValue={proposal.purchaseUnit ?? "roll"} className="mt-2" required>
          {PURCHASE_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {PURCHASE_UNIT_LABELS[unit]}
            </option>
          ))}
        </Select>
      </div>
      <Field id="thicknessMm" label="Thickness (mm)" name="thicknessMm" defaultValue={proposal.thicknessMm ?? ""} />
      <Field id="colour" label="Colour" name="colour" defaultValue={proposal.colour ?? ""} />
      <Field id="finish" label="Finish" name="finish" defaultValue={proposal.finish ?? ""} />
      <Field id="purchaseWidthMm" label="Width (mm)" name="purchaseWidthMm" defaultValue={proposal.purchaseWidthMm ?? ""} />
      <Field id="purchaseHeightMm" label="Height (mm)" name="purchaseHeightMm" defaultValue={proposal.purchaseHeightMm ?? ""} />
      <Field id="purchaseLengthMm" label="Roll length (mm)" name="purchaseLengthMm" defaultValue={proposal.purchaseLengthMm ?? ""} />
      <div>
        <Label htmlFor="supplier">Supplier</Label>
        <Input id="supplier" value={supplierName} readOnly className="mt-2" />
      </div>
      <Field id="supplierSku" label="Supplier SKU" name="supplierSku" defaultValue={proposal.supplierSku ?? ""} />
      <div className="md:col-span-2">
        <Label htmlFor="supplierDescription">Supplier product description</Label>
        <textarea
          id="supplierDescription"
          name="supplierDescription"
          defaultValue={proposal.supplierDescription}
          required
          rows={3}
          className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <Field id="price" label="Opening price (£)" name="price" defaultValue={proposal.price ?? ""} />
      <Field id="effectiveDate" label="Price effective date" name="effectiveDate" defaultValue={effectiveDate} type="date" />
      <label className="flex items-center gap-2 text-sm md:col-span-2">
        <input type="checkbox" name="preferred" defaultChecked={proposal.preferred} />
        Preferred supplier for this new material
      </label>
      <ul className="space-y-1 text-sm text-muted-foreground md:col-span-2">
        {proposal.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
        <li>This creates the opening price only. It does not change any existing approved price.</li>
      </ul>
      {error ? <p className="text-sm text-red-700 md:col-span-2">{error}</p> : null}
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create material and opening price"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  name,
  defaultValue,
  className,
  type = "text",
}: {
  id: string;
  label: string;
  name: string;
  defaultValue: string | number;
  className?: string;
  type?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type={type} defaultValue={defaultValue} className="mt-2" />
    </div>
  );
}
