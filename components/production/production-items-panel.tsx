"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { ProductionItemFormDialog } from "@/components/production/production-item-form-dialog";
import { Button } from "@/components/ui/button";
import {
  PRODUCTION_PRIORITY_LABELS,
  PRODUCTION_STATUS_LABELS,
} from "@/lib/production/constants";
import { formatCrmDateTime } from "@/lib/crm/format-datetime";
import type { ProductionItemRecord } from "@/lib/production/types";
import type { ProductionStaffProfile } from "@/lib/production/staff";

type ProductionItemsPanelProps = {
  jobId: string;
  items: ProductionItemRecord[];
  staff: ProductionStaffProfile[];
  schemaMissing?: boolean;
};

export function ProductionItemsPanel({
  jobId,
  items,
  staff,
  schemaMissing = false,
}: ProductionItemsPanelProps) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ProductionItemRecord | undefined>();
  const [actionError, setActionError] = useState("");
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  function openCreate() {
    setEditingItem(undefined);
    setFormOpen(true);
  }

  function openEdit(item: ProductionItemRecord) {
    setEditingItem(item);
    setFormOpen(true);
  }

  async function runItemAction(itemId: string, action: "duplicate" | "archive") {
    setBusyItemId(itemId);
    setActionError("");

    try {
      const response = await fetch("/api/admin/production/items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, action }),
      });

      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to update production item.");
      }

      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Unable to update production item."
      );
    } finally {
      setBusyItemId(null);
    }
  }

  if (schemaMissing) {
    return (
      <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-4 text-sm text-amber-900">
        <p className="font-medium">Production items migration not applied</p>
        <p className="mt-1 text-amber-800">
          Apply{" "}
          <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">
            supabase/migrations/20260803190000_production_items_foundation.sql
          </code>{" "}
          in Supabase to enable production item tracking.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Production items</h3>
          <p className="text-sm text-muted-foreground">
            Track individual pieces moving through the workshop.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={openCreate}>
            Add production item
          </Button>
          <Link href="/admin/production">
            <Button type="button" variant="outline">
              Open production board
            </Button>
          </Link>
        </div>
      </div>

      {actionError ? (
        <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          No production items yet. Add items to represent individual pieces in
          this job.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="px-4 py-3 font-medium">Required</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Machine</th>
                <th className="px-4 py-3 font-medium">Material</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-border/70">
                  <td className="px-4 py-4">
                    <p className="font-medium text-foreground">{item.item_name}</p>
                    {item.item_reference ? (
                      <p className="text-xs text-muted-foreground">
                        {item.item_reference}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-4">
                    {PRODUCTION_STATUS_LABELS[item.production_status]}
                  </td>
                  <td className="px-4 py-4">
                    {item.required_at
                      ? formatCrmDateTime(item.required_at)
                      : "—"}
                  </td>
                  <td className="px-4 py-4">
                    {PRODUCTION_PRIORITY_LABELS[item.priority]}
                  </td>
                  <td className="px-4 py-4">{item.machine ?? "—"}</td>
                  <td className="px-4 py-4">{item.material ?? "—"}</td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(item)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busyItemId === item.id}
                        onClick={() => void runItemAction(item.id, "duplicate")}
                      >
                        Duplicate
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busyItemId === item.id}
                        onClick={() => void runItemAction(item.id, "archive")}
                      >
                        Archive
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ProductionItemFormDialog
        jobId={jobId}
        mode={editingItem ? "edit" : "create"}
        item={editingItem}
        staff={staff}
        open={formOpen}
        onClose={() => setFormOpen(false)}
      />
    </div>
  );
}
