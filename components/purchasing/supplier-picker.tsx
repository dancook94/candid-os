"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createPurchaseOrderDraft } from "@/lib/purchasing/actions";
import {
  filterPurchasingSuppliers,
  type PurchasingSupplier,
} from "@/lib/purchasing/suppliers";

type SupplierPickerProps = {
  suppliers: PurchasingSupplier[];
};

export function SupplierPicker({ suppliers }: SupplierPickerProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const submitLock = useRef(false);
  const releaseSubmitLock = useCallback(() => {
    submitLock.current = false;
  }, []);
  const visibleSuppliers = filterPurchasingSuppliers(suppliers, query);
  const selected = suppliers.find((supplier) => supplier.id === selectedId) ?? null;

  return (
    <form
      action={createPurchaseOrderDraft}
      className="space-y-4"
      onSubmit={(event) => {
        if (submitLock.current || !selectedId) {
          event.preventDefault();
          return;
        }

        submitLock.current = true;
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="supplier-search">Search suppliers</Label>
        <Input
          id="supplier-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by supplier name"
          autoComplete="off"
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">
          Active suppliers
        </legend>

        {visibleSuppliers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No suppliers match that search.
          </p>
        ) : (
          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {visibleSuppliers.map((supplier) => {
              const checked = supplier.id === selectedId;

              return (
                <label
                  key={supplier.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 text-sm has-[:checked]:border-foreground has-[:checked]:bg-muted/40"
                >
                  <input
                    type="radio"
                    name="supplierChoice"
                    value={supplier.id}
                    checked={checked}
                    onChange={() => setSelectedId(supplier.id)}
                    className="size-4 accent-foreground"
                  />
                  <span className="min-w-0 font-medium text-foreground">
                    {supplier.name}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>

      {selected ? (
        <input type="hidden" name="supplierId" value={selected.id} />
      ) : null}

      <div className="flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {selected ? `Selected: ${selected.name}` : "Select a supplier to continue."}
        </p>
        <CreateDraftButton
          disabled={!selected}
          onSettled={releaseSubmitLock}
        />
      </div>
    </form>
  );
}

function CreateDraftButton({
  disabled,
  onSettled,
}: {
  disabled: boolean;
  onSettled: () => void;
}) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending) {
      onSettled();
    }

    wasPending.current = pending;
  }, [onSettled, pending]);

  return (
    <Button type="submit" disabled={disabled || pending} className="w-full sm:w-auto">
      {pending ? "Creating draft…" : "Create draft"}
    </Button>
  );
}
