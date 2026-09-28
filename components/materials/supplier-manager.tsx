"use client";

import { FormEvent, useState } from "react";

import { useMaterialsSave } from "@/components/materials/use-materials-save";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SupplierRecord } from "@/lib/materials/present";

export function SupplierCreateForm() {
  const { error, pending, save } = useMaterialsSave();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const saved = await save("/api/admin/materials/suppliers", "POST", {
      name: new FormData(form).get("name"),
    });

    if (saved) {
      form.reset();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-2">
        <Label htmlFor="supplier-name">Supplier name</Label>
        <Input id="supplier-name" name="name" required placeholder="Antalis" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add supplier"}
      </Button>
      {error ? <p className="text-sm text-red-700 sm:basis-full">{error}</p> : null}
    </form>
  );
}

export function SupplierEditForm({ supplier }: { supplier: SupplierRecord }) {
  const { error, pending, save } = useMaterialsSave();
  const [active, setActive] = useState(supplier.active);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await save(`/api/admin/materials/suppliers/${supplier.id}`, "PATCH", {
      name: new FormData(event.currentTarget).get("name"),
      active,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <Input
        name="name"
        aria-label={`Name for ${supplier.name}`}
        defaultValue={supplier.name}
        required
        className="lg:max-w-sm"
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
        />
        Active
      </label>
      <StatusBadge status={supplier.active ? "approved" : "disabled"} label={supplier.active ? "Active" : "Inactive"} />
      <span className="text-sm text-muted-foreground">
        {supplier.productCount} product{supplier.productCount === 1 ? "" : "s"}
      </span>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      {error ? <p className="text-sm text-red-700 lg:basis-full">{error}</p> : null}
    </form>
  );
}
