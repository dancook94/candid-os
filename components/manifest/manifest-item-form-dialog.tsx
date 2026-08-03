"use client";

import { FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import type { ManifestItemFormInput } from "@/lib/manifest/types";
import type { ManifestSourceType } from "@/lib/manifest/constants";
import type { ManifestItemRecord } from "@/lib/manifest/types";

type ManifestItemFormDialogProps = {
  jobId: string;
  mode: "create" | "edit";
  item?: ManifestItemRecord;
  defaultSourceType?: ManifestSourceType;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export function ManifestItemFormDialog({
  jobId,
  mode,
  item,
  defaultSourceType = "additional",
  open,
  onClose,
  onSaved,
}: ManifestItemFormDialogProps) {
  const [itemName, setItemName] = useState(item?.item_name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [quantity, setQuantity] = useState(
    item?.quantity !== null && item?.quantity !== undefined ? String(item.quantity) : ""
  );
  const [unit, setUnit] = useState(item?.unit ?? "each");
  const [material, setMaterial] = useState(item?.material ?? "");
  const [machine, setMachine] = useState(item?.machine ?? "");
  const [widthMm, setWidthMm] = useState(
    item?.width_mm !== null && item?.width_mm !== undefined ? String(item.width_mm) : ""
  );
  const [heightMm, setHeightMm] = useState(
    item?.height_mm !== null && item?.height_mm !== undefined ? String(item.height_mm) : ""
  );
  const [internalNote, setInternalNote] = useState(item?.internal_note ?? "");
  const [sourceType, setSourceType] = useState<ManifestSourceType>(
    item?.source_type ?? defaultSourceType
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setItemName(item?.item_name ?? "");
    setDescription(item?.description ?? "");
    setQuantity(
      item?.quantity !== null && item?.quantity !== undefined ? String(item.quantity) : ""
    );
    setUnit(item?.unit ?? "each");
    setMaterial(item?.material ?? "");
    setMachine(item?.machine ?? "");
    setWidthMm(
      item?.width_mm !== null && item?.width_mm !== undefined ? String(item.width_mm) : ""
    );
    setHeightMm(
      item?.height_mm !== null && item?.height_mm !== undefined ? String(item.height_mm) : ""
    );
    setInternalNote(item?.internal_note ?? "");
    setSourceType(item?.source_type ?? defaultSourceType);
    setError("");
  }, [open, item, defaultSourceType]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    const payload: ManifestItemFormInput & {
      jobId?: string;
      itemId?: string;
      sourceType?: ManifestSourceType;
    } = {
      jobId,
      itemId: item?.id,
      itemName,
      description: description || null,
      quantity: quantity ? Number(quantity) : null,
      unit: unit || "each",
      material: material || null,
      machine: machine || null,
      widthMm: widthMm ? Number(widthMm) : null,
      heightMm: heightMm ? Number(heightMm) : null,
      internalNote: internalNote || null,
      sourceType,
    };

    try {
      const response = await fetch("/api/admin/manifest/items", {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to save manifest item.");
      }

      onSaved();
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to save manifest item."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="portal-surface max-h-[90vh] w-full max-w-2xl overflow-y-auto">
        <CardHeader className="border-b border-border">
          <CardTitle>
            {mode === "create" ? "Add manifest item" : "Edit manifest item"}
          </CardTitle>
          <CardDescription>
            Track production requirements and billing treatment for this job.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="itemName">Item name</Label>
              <Input id="itemName" value={itemName} onChange={(e) => setItemName(e.target.value)} required />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input id="quantity" type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit">Unit</Label>
              <Input id="unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="material">Material</Label>
              <Input id="material" value={material} onChange={(e) => setMaterial(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="machine">Machine</Label>
              <Input id="machine" value={machine} onChange={(e) => setMachine(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="widthMm">Width (mm)</Label>
              <Input id="widthMm" type="number" min="0" step="any" value={widthMm} onChange={(e) => setWidthMm(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="heightMm">Height (mm)</Label>
              <Input id="heightMm" type="number" min="0" step="any" value={heightMm} onChange={(e) => setHeightMm(e.target.value)} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="internalNote">Internal note</Label>
              <Textarea id="internalNote" value={internalNote} onChange={(e) => setInternalNote(e.target.value)} rows={2} />
            </div>
            {mode === "create" ? (
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="sourceType">Source</Label>
                <Select id="sourceType" value={sourceType} onChange={(e) => setSourceType(e.target.value as ManifestSourceType)}>
                  <option value="additional">Additional</option>
                  <option value="replacement">Replacement</option>
                  <option value="reprint">Reprint</option>
                  <option value="manual">Manual</option>
                  <option value="external">External</option>
                </Select>
              </div>
            ) : null}
            {error ? <p className="md:col-span-2 text-sm text-destructive">{error}</p> : null}
            <div className="flex gap-3 md:col-span-2">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : mode === "create" ? "Add item" : "Save changes"}
              </Button>
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
