"use client";

import { useState } from "react";
import Link from "next/link";

import { ManifestItemFormDialog } from "@/components/manifest/manifest-item-form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  MANIFEST_BILLING_STATUS_LABELS,
  MANIFEST_SOURCE_TYPE_LABELS,
  PRODUCTION_REQUIREMENT_STATUS_LABELS,
} from "@/lib/manifest/constants";
import type { ProductionReadinessSummary } from "@/lib/manifest/readiness";
import type { ManifestItemRecord } from "@/lib/manifest/types";
import { PRODUCTION_STATUS_LABELS } from "@/lib/production/constants";
import { cn } from "@/lib/utils";

type ProductionManifestPanelProps = {
  jobId: string;
  items: ManifestItemRecord[];
  readiness: ProductionReadinessSummary;
  schemaMissing?: boolean;
  manifestMigrationMissing?: boolean;
};

function SourceBadge({ sourceType }: { sourceType: string }) {
  return (
    <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground ring-1 ring-border">
      {MANIFEST_SOURCE_TYPE_LABELS[sourceType as keyof typeof MANIFEST_SOURCE_TYPE_LABELS] ??
        sourceType}
    </span>
  );
}

function CancelDialog({
  open,
  onClose,
  onConfirm,
  isSubmitting,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  isSubmitting: boolean;
}) {
  const [reason, setReason] = useState("");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="portal-surface w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
        <h3 className="text-lg font-semibold">Cancel item by customer</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          This item will be excluded from production readiness and the invoice draft.
        </p>
        <div className="mt-4 space-y-2">
          <Label htmlFor="cancelReason">Reason</Label>
          <Textarea
            id="cancelReason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            required
          />
        </div>
        <div className="mt-5 flex gap-3">
          <Button
            type="button"
            disabled={isSubmitting || !reason.trim()}
            onClick={() => onConfirm(reason.trim())}
          >
            Confirm cancellation
          </Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ProductionManifestPanel({
  jobId,
  items,
  readiness,
  schemaMissing = false,
  manifestMigrationMissing = false,
}: ProductionManifestPanelProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ManifestItemRecord | undefined>();
  const [cancelItem, setCancelItem] = useState<ManifestItemRecord | undefined>();
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [showOverride, setShowOverride] = useState(false);

  async function refreshPage() {
    window.location.reload();
  }

  async function createManifest() {
    setBusy(true);
    setActionError("");
    setActionMessage("");

    try {
      const response = await fetch(`/api/admin/jobs/${jobId}/manifest`, {
        method: "POST",
      });
      const result = (await response.json()) as {
        error?: string;
        created?: number;
        skipped?: number;
      };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to create production manifest.");
      }

      setActionMessage(
        `Manifest reconciled: ${result.created ?? 0} created, ${result.skipped ?? 0} skipped.`
      );
      await refreshPage();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Unable to create production manifest."
      );
    } finally {
      setBusy(false);
    }
  }

  async function runAction(itemId: string, action: string, extra?: Record<string, unknown>) {
    setBusy(true);
    setActionError("");

    try {
      const response = await fetch("/api/admin/manifest/items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, action, ...extra }),
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to update manifest item.");
      }

      await refreshPage();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Unable to update manifest item."
      );
    } finally {
      setBusy(false);
    }
  }

  async function markReadyToPrint() {
    if (!overrideReason.trim()) return;

    setBusy(true);
    setActionError("");

    try {
      const response = await fetch(`/api/admin/jobs/${jobId}/ready-to-print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: overrideReason.trim() }),
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to mark ready to print.");
      }

      setShowOverride(false);
      setOverrideReason("");
      await refreshPage();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Unable to mark ready to print."
      );
    } finally {
      setBusy(false);
    }
  }

  if (schemaMissing) {
    return (
      <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-4 text-sm text-amber-900">
        <p className="font-medium">Production items migration not applied</p>
        <p className="mt-1 text-amber-800">
          Apply the production_items foundation migration before using the production manifest.
        </p>
      </div>
    );
  }

  if (manifestMigrationMissing) {
    return (
      <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-4 text-sm text-amber-900">
        <p className="font-medium">Production manifest migration not applied</p>
        <p className="mt-1 text-amber-800">
          Apply{" "}
          <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">
            supabase/migrations/20260803200000_production_manifest_invoice_foundation.sql
          </code>
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Production manifest</h3>
          <p className="text-sm text-muted-foreground">
            Quoted, changed and additional production requirements for this job.
          </p>
          <p className="mt-2 text-sm font-medium text-foreground">
            Production readiness: {readiness.label}
            {readiness.isReady ? (
              <span className="ml-2 text-emerald-700">Ready</span>
            ) : (
              <span className="ml-2 text-amber-700">Not ready</span>
            )}
          </p>
          {readiness.proofBlocked ? (
            <p className="mt-1 text-sm text-amber-800">
              Ready to Print blocked: {readiness.proofStatusLabel ?? "Proof approval required"}
            </p>
          ) : null}
          {readiness.unresolvedRequirements && readiness.unresolvedRequirements.length > 0 ? (
            <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
              {readiness.unresolvedRequirements.map((item) => (
                <li key={item}>Unresolved: {item}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void createManifest()} disabled={busy}>
            Create production manifest
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setEditingItem(undefined);
              setFormOpen(true);
            }}
          >
            Add additional item
          </Button>
          <Link href={`/admin/jobs/${jobId}/invoice`}>
            <Button type="button" variant="outline">
              Prepare invoice
            </Button>
          </Link>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setShowOverride((v) => !v)}>
          Mark ready to print
        </Button>
      </div>

      {showOverride ? (
        <div className="mb-4 rounded-xl border border-border bg-muted/20 p-4">
          <Label htmlFor="overrideReason">Override reason</Label>
          <Input
            id="overrideReason"
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            className="mt-2"
            placeholder="Why is this job being marked ready to print?"
          />
          <div className="mt-3 flex gap-2">
            <Button type="button" size="sm" disabled={busy || !overrideReason.trim()} onClick={() => void markReadyToPrint()}>
              Confirm override
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setShowOverride(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {actionError ? (
        <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      {actionMessage ? (
        <p className="mb-4 rounded-lg border border-emerald-300/40 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {actionMessage}
        </p>
      ) : null}

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          No production manifest items yet. Create the manifest from the accepted quote to begin.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const isCancelled = item.production_requirement_status === "cancelled";
            const isAdditional = item.source_type !== "quoted";

            return (
              <div
                key={item.id}
                className={cn(
                  "rounded-xl border border-border bg-card p-4 shadow-sm",
                  isCancelled && "opacity-60",
                  isAdditional && "border-[var(--candid-yellow)]/40"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-foreground">{item.item_name}</p>
                      <SourceBadge sourceType={item.source_type} />
                    </div>
                    {item.item_reference ? (
                      <p className="text-xs text-muted-foreground">{item.item_reference}</p>
                    ) : null}
                    {item.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                    ) : null}
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>
                      Quoted qty: {item.quoted_quantity ?? "—"} · Current qty:{" "}
                      {item.quantity ?? "—"}
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-4">
                  <p>
                    Requirement:{" "}
                    {
                      PRODUCTION_REQUIREMENT_STATUS_LABELS[
                        item.production_requirement_status
                      ]
                    }
                  </p>
                  <p>Production: {PRODUCTION_STATUS_LABELS[item.production_status]}</p>
                  <p>Billing: {MANIFEST_BILLING_STATUS_LABELS[item.billing_status]}</p>
                  <p>
                    PrintFactory:{" "}
                    {item.requires_printfactory
                      ? item.printfactory_satisfied
                        ? "Satisfied"
                        : "Required"
                      : "Not required"}
                  </p>
                  {item.material ? <p>Material: {item.material}</p> : null}
                  {item.machine ? <p>Machine: {item.machine}</p> : null}
                  {item.customer_change_reason ? (
                    <p className="md:col-span-2 text-amber-800">
                      Cancelled: {item.customer_change_reason}
                    </p>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => { setEditingItem(item); setFormOpen(true); }}>
                    Edit
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void runAction(item.id, "duplicate")}>
                    Duplicate
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setCancelItem(item)}>
                    Cancel by customer
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void runAction(item.id, "mark_not_required")}>
                    Not required
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void runAction(item.id, "mark_external")}>
                    External
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void runAction(item.id, "mark_manual_production")}>
                    Manual production
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void runAction(item.id, "mark_no_charge_reprint")}>
                    No-charge reprint
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void runAction(item.id, item.requires_printfactory ? "no_printfactory" : "requires_printfactory")}>
                    {item.requires_printfactory ? "Remove PrintFactory req." : "Requires PrintFactory"}
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void runAction(item.id, "archive")}>
                    Archive
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ManifestItemFormDialog
        jobId={jobId}
        mode={editingItem ? "edit" : "create"}
        item={editingItem}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => void refreshPage()}
      />

      <CancelDialog
        open={Boolean(cancelItem)}
        onClose={() => setCancelItem(undefined)}
        isSubmitting={busy}
        onConfirm={(reason) => {
          if (!cancelItem) return;
          void runAction(cancelItem.id, "cancel_customer", { reason }).then(() =>
            setCancelItem(undefined)
          );
        }}
      />
    </div>
  );
}
