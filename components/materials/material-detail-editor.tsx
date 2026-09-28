"use client";

import { FormEvent, useState } from "react";

import { useMaterialsSave } from "@/components/materials/use-materials-save";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatGbp } from "@/lib/format-currency";
import type { SupplierProductView, SupplierRecord } from "@/lib/materials/present";
import { PURCHASE_UNIT_LABELS, PURCHASE_UNITS } from "@/lib/materials/units";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function SupplierProductCreateForm({
  materialId,
  suppliers,
}: {
  materialId: string;
  suppliers: SupplierRecord[];
}) {
  const { error, pending, save } = useMaterialsSave();
  const [preferred, setPreferred] = useState(false);
  const activeSuppliers = suppliers.filter((supplier) => supplier.active);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const saved = await save(
      `/api/admin/materials/${materialId}/supplier-products`,
      "POST",
      {
        supplierId: new FormData(form).get("supplierId"),
        supplierSku: new FormData(form).get("supplierSku"),
        supplierDescription: new FormData(form).get("supplierDescription"),
        isPreferred: preferred,
      }
    );

    if (saved) {
      form.reset();
      setPreferred(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="supplierId">Supplier</Label>
        <Select id="supplierId" name="supplierId" required defaultValue="">
          <option value="" disabled>
            Choose a supplier
          </option>
          {activeSuppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="supplierSku">Supplier SKU</Label>
        <Input id="supplierSku" name="supplierSku" />
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="supplierDescription">Supplier description</Label>
        <Input
          id="supplierDescription"
          name="supplierDescription"
          required
          placeholder="Description as it appears on the supplier invoice"
        />
      </div>
      <label className="flex items-center gap-2 text-sm md:col-span-2">
        <input
          type="checkbox"
          checked={preferred}
          onChange={(event) => setPreferred(event.target.checked)}
        />
        Preferred supplier product
      </label>
      {activeSuppliers.length === 0 ? (
        <p className="text-sm text-muted-foreground md:col-span-2">
          Add an active supplier before mapping a product.
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-700 md:col-span-2">{error}</p> : null}
      <div>
        <Button type="submit" disabled={pending || activeSuppliers.length === 0}>
          {pending ? "Adding…" : "Add supplier product"}
        </Button>
      </div>
    </form>
  );
}

export function SupplierProductCard({
  product,
  suppliers,
  defaultPriceUnit,
}: {
  product: SupplierProductView;
  suppliers: SupplierRecord[];
  defaultPriceUnit: string;
}) {
  const productSave = useMaterialsSave();
  const priceSave = useMaterialsSave();
  const [active, setActive] = useState(product.active);
  const [preferred, setPreferred] = useState(product.isPreferred);

  async function handleProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await productSave.save(
      `/api/admin/materials/supplier-products/${product.id}`,
      "PATCH",
      {
        supplierId: form.get("supplierId"),
        supplierSku: form.get("supplierSku"),
        supplierDescription: form.get("supplierDescription"),
        active,
        isPreferred: preferred,
      }
    );
  }

  async function handlePrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const saved = await priceSave.save(
      `/api/admin/materials/supplier-products/${product.id}/prices`,
      "POST",
      {
        price: new FormData(formElement).get("price"),
        priceUnit: new FormData(formElement).get("priceUnit"),
        effectiveDate: new FormData(formElement).get("effectiveDate"),
        sourceReference: new FormData(formElement).get("sourceReference"),
      }
    );

    if (saved) {
      formElement.reset();
    }
  }

  return (
    <article className="rounded-2xl border border-border/80 p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{product.supplierName}</h3>
        {product.isPreferred ? (
          <StatusBadge status="approved" label="Preferred" />
        ) : null}
        <StatusBadge
          status={product.active ? "approved" : "disabled"}
          label={product.active ? "Active" : "Inactive"}
        />
      </div>

      <form onSubmit={handleProduct} className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`supplier-${product.id}`}>Supplier</Label>
          <Select
            id={`supplier-${product.id}`}
            name="supplierId"
            defaultValue={product.supplierId}
          >
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`sku-${product.id}`}>Supplier SKU</Label>
          <Input
            id={`sku-${product.id}`}
            name="supplierSku"
            defaultValue={product.supplierSku ?? ""}
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor={`description-${product.id}`}>Supplier description</Label>
          <Input
            id={`description-${product.id}`}
            name="supplierDescription"
            required
            defaultValue={product.supplierDescription}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={preferred}
            onChange={(event) => setPreferred(event.target.checked)}
          />
          Preferred
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => {
              setActive(event.target.checked);
              if (!event.target.checked) {
                setPreferred(false);
              }
            }}
          />
          Active
        </label>
        <p className="text-sm text-muted-foreground md:col-span-2">
          Current approved price:{" "}
          {product.currentPrice
            ? `${formatGbp(product.currentPrice.price)} per ${PURCHASE_UNIT_LABELS[product.currentPrice.priceUnit].toLowerCase()}`
            : "None"}
          {product.currentPrice
            ? ` · ${product.currentPrice.effectiveDate}`
            : ""}
        </p>
        {productSave.error ? (
          <p className="text-sm text-red-700 md:col-span-2">{productSave.error}</p>
        ) : null}
        <div>
          <Button type="submit" variant="outline" disabled={productSave.pending}>
            {productSave.pending ? "Saving…" : "Save supplier product"}
          </Button>
        </div>
      </form>

      <form onSubmit={handlePrice} className="mt-5 grid gap-4 border-t border-border/70 pt-5 md:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor={`price-${product.id}`}>Approved price</Label>
          <Input id={`price-${product.id}`} name="price" inputMode="decimal" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`price-unit-${product.id}`}>Price unit</Label>
          <Select
            id={`price-unit-${product.id}`}
            name="priceUnit"
            defaultValue={product.currentPrice?.priceUnit ?? defaultPriceUnit}
          >
            {PURCHASE_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {PURCHASE_UNIT_LABELS[unit]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`effective-${product.id}`}>Effective date</Label>
          <Input
            id={`effective-${product.id}`}
            name="effectiveDate"
            type="date"
            required
            defaultValue={todayIsoDate()}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`source-${product.id}`}>Source / reference</Label>
          <Input id={`source-${product.id}`} name="sourceReference" />
        </div>
        {priceSave.error ? (
          <p className="text-sm text-red-700 md:col-span-4">{priceSave.error}</p>
        ) : null}
        <div className="md:col-span-4">
          <Button type="submit" disabled={priceSave.pending || !product.active}>
            {priceSave.pending ? "Adding…" : "Add approved price"}
          </Button>
        </div>
      </form>
    </article>
  );
}
