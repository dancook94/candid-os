"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  PRODUCTION_PRIORITIES,
  PRODUCTION_PRIORITY_LABELS,
  PRODUCTION_SIDES,
} from "@/lib/production/constants";
import type { ProductionPriority, ProductionSides, ProductionStatus } from "@/lib/production/constants";
import { getProductionStageOptions } from "@/lib/production/board";
import type { ProductionItemRecord } from "@/lib/production/types";
import type { ProductionStaffProfile } from "@/lib/production/staff";

type ProductionItemFormDialogProps = {
  jobId: string;
  mode: "create" | "edit";
  item?: ProductionItemRecord;
  staff: ProductionStaffProfile[];
  open: boolean;
  onClose: () => void;
};

export function ProductionItemFormDialog({
  jobId,
  mode,
  item,
  staff,
  open,
  onClose,
}: ProductionItemFormDialogProps) {
  const router = useRouter();
  const [itemName, setItemName] = useState(item?.item_name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [quantity, setQuantity] = useState(
    item?.quantity !== null && item?.quantity !== undefined
      ? String(item.quantity)
      : ""
  );
  const [requiredAt, setRequiredAt] = useState(
    item?.required_at ? item.required_at.slice(0, 16) : ""
  );
  const [priority, setPriority] = useState<ProductionPriority>(item?.priority ?? "normal");
  const [machine, setMachine] = useState(item?.machine ?? "");
  const [material, setMaterial] = useState(item?.material ?? "");
  const [widthMm, setWidthMm] = useState(
    item?.width_mm !== null && item?.width_mm !== undefined
      ? String(item.width_mm)
      : ""
  );
  const [heightMm, setHeightMm] = useState(
    item?.height_mm !== null && item?.height_mm !== undefined
      ? String(item.height_mm)
      : ""
  );
  const [copies, setCopies] = useState(
    item?.copies !== null && item?.copies !== undefined ? String(item.copies) : ""
  );
  const [sides, setSides] = useState<ProductionSides | "">(item?.sides ?? "");
  const [finishingNotes, setFinishingNotes] = useState(item?.finishing_notes ?? "");
  const [assignedToProfileId, setAssignedToProfileId] = useState(
    item?.assigned_to_profile_id ?? ""
  );
  const [productionStatus, setProductionStatus] = useState<ProductionStatus>(
    item?.production_status ?? "artwork"
  );
  const [synologySourcePath, setSynologySourcePath] = useState(
    item?.synology_source_path ?? ""
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;

    setItemName(item?.item_name ?? "");
    setDescription(item?.description ?? "");
    setQuantity(
      item?.quantity !== null && item?.quantity !== undefined
        ? String(item.quantity)
        : ""
    );
    setRequiredAt(item?.required_at ? item.required_at.slice(0, 16) : "");
    setPriority(item?.priority ?? "normal");
    setMachine(item?.machine ?? "");
    setMaterial(item?.material ?? "");
    setWidthMm(
      item?.width_mm !== null && item?.width_mm !== undefined
        ? String(item.width_mm)
        : ""
    );
    setHeightMm(
      item?.height_mm !== null && item?.height_mm !== undefined
        ? String(item.height_mm)
        : ""
    );
    setCopies(
      item?.copies !== null && item?.copies !== undefined ? String(item.copies) : ""
    );
    setSides(item?.sides ?? "");
    setFinishingNotes(item?.finishing_notes ?? "");
    setAssignedToProfileId(item?.assigned_to_profile_id ?? "");
    setProductionStatus(item?.production_status ?? "artwork");
    setSynologySourcePath(item?.synology_source_path ?? "");
    setError("");
  }, [open, item]);

  function handleClose() {
    if (isSubmitting) return;
    onClose();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    const payload = {
      jobId,
      itemId: item?.id,
      itemName,
      description: description || null,
      quantity: quantity ? Number(quantity) : null,
      requiredAt: requiredAt ? new Date(requiredAt).toISOString() : null,
      priority,
      machine: machine || null,
      material: material || null,
      widthMm: widthMm ? Number(widthMm) : null,
      heightMm: heightMm ? Number(heightMm) : null,
      copies: copies ? Number(copies) : null,
      sides: sides || null,
      finishingNotes: finishingNotes || null,
      assignedToProfileId: assignedToProfileId || null,
      productionStatus,
      synologySourcePath: synologySourcePath || null,
    };

    try {
      const response = await fetch("/api/admin/production/items", {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to save production item.");
      }

      router.refresh();
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to save production item."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="portal-surface max-h-[90vh] w-full max-w-2xl overflow-y-auto">
        <CardHeader className="border-b border-border">
          <CardTitle>
            {mode === "create" ? "Add production item" : "Edit production item"}
          </CardTitle>
          <CardDescription>
            Production items track individual pieces within a job. PrintFactory
            matching is optional.
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="itemName">Item name</Label>
              <Input
                id="itemName"
                value={itemName}
                onChange={(event) => setItemName(event.target.value)}
                required
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                min="0"
                step="any"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="requiredAt">Required date/time</Label>
              <Input
                id="requiredAt"
                type="datetime-local"
                value={requiredAt}
                onChange={(event) => setRequiredAt(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select
                id="priority"
                value={priority}
                onChange={(event) =>
                  setPriority(event.target.value as ProductionPriority)
                }
              >
                {PRODUCTION_PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {PRODUCTION_PRIORITY_LABELS[value]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="productionStatus">Initial production stage</Label>
              <Select
                id="productionStatus"
                value={productionStatus}
                onChange={(event) =>
                  setProductionStatus(event.target.value as ProductionStatus)
                }
              >
                {getProductionStageOptions().map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="machine">Machine</Label>
              <Input
                id="machine"
                value={machine}
                onChange={(event) => setMachine(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="material">Material</Label>
              <Input
                id="material"
                value={material}
                onChange={(event) => setMaterial(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="widthMm">Width (mm)</Label>
              <Input
                id="widthMm"
                type="number"
                min="0"
                step="any"
                value={widthMm}
                onChange={(event) => setWidthMm(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="heightMm">Height (mm)</Label>
              <Input
                id="heightMm"
                type="number"
                min="0"
                step="any"
                value={heightMm}
                onChange={(event) => setHeightMm(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="copies">Copies</Label>
              <Input
                id="copies"
                type="number"
                min="0"
                step="1"
                value={copies}
                onChange={(event) => setCopies(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sides">Sides</Label>
              <Select
                id="sides"
                value={sides}
                onChange={(event) =>
                  setSides(event.target.value as ProductionSides | "")
                }
              >
                <option value="">Not specified</option>
                {PRODUCTION_SIDES.map((value) => (
                  <option key={value} value={value}>
                    {value.charAt(0).toUpperCase() + value.slice(1)}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="finishingNotes">Finishing notes</Label>
              <Textarea
                id="finishingNotes"
                value={finishingNotes}
                onChange={(event) => setFinishingNotes(event.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="assignedToProfileId">Assigned staff</Label>
              <Select
                id="assignedToProfileId"
                value={assignedToProfileId}
                onChange={(event) => setAssignedToProfileId(event.target.value)}
              >
                <option value="">Unassigned</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.full_name?.trim() || "Unnamed staff member"}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="synologySourcePath">Synology source path</Label>
              <Input
                id="synologySourcePath"
                value={synologySourcePath}
                onChange={(event) => setSynologySourcePath(event.target.value)}
                placeholder="/Jobs/J-1048 - Company/04 Production Files/file.pdf"
              />
              <p className="text-xs text-muted-foreground">
                Optional. Used later to match PrintFactory jobs by Candid job
                reference in the file path.
              </p>
            </div>

            {error ? (
              <p className="md:col-span-2 text-sm text-destructive">{error}</p>
            ) : null}

            <div className="flex flex-wrap gap-3 md:col-span-2">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? "Saving…"
                  : mode === "create"
                    ? "Add item"
                    : "Save changes"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
