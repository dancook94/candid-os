"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { useMaterialsSave } from "@/components/materials/use-materials-save";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { MaterialRecord } from "@/lib/materials/present";
import { PURCHASE_UNIT_LABELS, PURCHASE_UNITS } from "@/lib/materials/units";

type MaterialFormProps = {
  mode: "create" | "edit";
  material?: MaterialRecord;
};

function dimensionValue(value: number | null | undefined) {
  return value == null ? "" : String(value);
}

export function MaterialForm({ mode, material }: MaterialFormProps) {
  const router = useRouter();
  const { error, pending, save } = useMaterialsSave();
  const [active, setActive] = useState(material?.active ?? true);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const savedId = await save(
      mode === "create"
        ? "/api/admin/materials"
        : `/api/admin/materials/${material?.id}`,
      mode === "create" ? "POST" : "PATCH",
      {
        name: form.get("name"),
        category: form.get("category"),
        thicknessMm: form.get("thicknessMm"),
        colour: form.get("colour"),
        finish: form.get("finish"),
        purchaseUnit: form.get("purchaseUnit"),
        purchaseWidthMm: form.get("purchaseWidthMm"),
        purchaseHeightMm: form.get("purchaseHeightMm"),
        purchaseLengthMm: form.get("purchaseLengthMm"),
        active,
      }
    );

    if (savedId && mode === "create") {
      router.push(`/admin/materials/${savedId}`);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-5 md:grid-cols-2">
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="name">Material</Label>
        <Input
          id="name"
          name="name"
          required
          defaultValue={material?.name ?? ""}
          placeholder="Foamalite White"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="category">Category</Label>
        <Input
          id="category"
          name="category"
          defaultValue={material?.category ?? ""}
          placeholder="Rigid board"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="purchaseUnit">Purchase format</Label>
        <Select
          id="purchaseUnit"
          name="purchaseUnit"
          required
          defaultValue={material?.purchaseUnit ?? "sheet"}
        >
          {PURCHASE_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {PURCHASE_UNIT_LABELS[unit]}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="thicknessMm">Thickness (mm)</Label>
        <Input
          id="thicknessMm"
          name="thicknessMm"
          inputMode="decimal"
          defaultValue={dimensionValue(material?.thicknessMm)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="colour">Colour</Label>
        <Input id="colour" name="colour" defaultValue={material?.colour ?? ""} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="finish">Finish</Label>
        <Input id="finish" name="finish" defaultValue={material?.finish ?? ""} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="purchaseWidthMm">Width (mm)</Label>
        <Input
          id="purchaseWidthMm"
          name="purchaseWidthMm"
          inputMode="decimal"
          defaultValue={dimensionValue(material?.purchaseWidthMm)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="purchaseHeightMm">Sheet height (mm)</Label>
        <Input
          id="purchaseHeightMm"
          name="purchaseHeightMm"
          inputMode="decimal"
          defaultValue={dimensionValue(material?.purchaseHeightMm)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="purchaseLengthMm">Roll length (mm)</Label>
        <Input
          id="purchaseLengthMm"
          name="purchaseLengthMm"
          inputMode="decimal"
          defaultValue={dimensionValue(material?.purchaseLengthMm)}
        />
      </div>

      {mode === "edit" ? (
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
          />
          Active
        </label>
      ) : null}

      {error ? <p className="text-sm text-red-700 md:col-span-2">{error}</p> : null}

      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Create material" : "Save material"}
        </Button>
      </div>
    </form>
  );
}
