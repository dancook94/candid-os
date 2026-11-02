"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  purchaseUnitGuidance,
  type BulkReviewGroup,
  type BulkReviewKind,
  type BulkReviewSummary,
} from "@/lib/materials/invoices/bulk-review";
import { formatGbp } from "@/lib/materials/invoices/money";
import { PURCHASE_UNIT_LABELS, PURCHASE_UNITS, type PurchaseUnit } from "@/lib/materials/units";

type BulkSubmission =
  | { action: "ignore_charges" }
  | { action: "confirm_product"; productId: string }
  | { action: "keep_historical_price" }
  | { action: "approve_current_price"; approveCurrent: true }
  | { action: "set_purchase_unit"; unit: PurchaseUnit }
  | { action: "accept_rounding"; acceptRounding: true }
  | {
      action: "create_material";
      name: string;
      openingPrice: number;
      acknowledgedSimilar: boolean;
    };

const KIND_LABELS: Record<BulkReviewKind, string> = {
  repair: "Extraction repair",
  rounding: "Rounding differences",
  charge: "Non-material charges",
  historical_price: "Historical prices",
  existing_product: "Existing materials",
  purchase_unit: "Purchase units",
  new_material: "New materials",
};

type BulkReviewPanelProps = {
  groups: BulkReviewGroup[];
  summary: BulkReviewSummary;
};

export function BulkReviewPanel({ groups, summary }: BulkReviewPanelProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(groups.map((group) => [group.id, group.lines.map((line) => line.id)]))
  );
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.map((group) => [group.id, group.proposedName ?? group.title]))
  );
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Record<string, PurchaseUnit | "">>({});
  const [products, setProducts] = useState<Record<string, string>>({});
  const [approveCurrent, setApproveCurrent] = useState<Record<string, boolean>>({});
  const [acceptRounding, setAcceptRounding] = useState<Record<string, boolean>>({});
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sections = useMemo(
    () => (Object.keys(KIND_LABELS) as BulkReviewKind[]).map((kind) => ({
      kind,
      groups: groups.filter((group) => group.kind === kind),
    })),
    [groups]
  );

  async function submit(group: BulkReviewGroup, decision: BulkSubmission) {
    const lineIds = selected[group.id] ?? [];

    if (lineIds.length === 0) {
      setError("Select at least one line in this group.");
      return;
    }

    setPendingId(group.id);
    setError(null);
    setMessage(null);
    const response = await fetch("/api/admin/materials/invoices/bulk-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...decision, confirmed: true, lineIds }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; alreadyComplete?: boolean };
    setPendingId(null);

    if (!response.ok) {
      setError(body.error ?? "The decision could not be saved.");
      return;
    }

    setMessage(body.alreadyComplete ? "Those lines were already decided." : "The selected lines were updated.");
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <Card className="rounded-2xl shadow-sm ring-0">
        <CardContent className="grid gap-4 p-6 sm:grid-cols-4">
          <Summary label="Open lines" value={summary.openLineCount} />
          <Summary label="Can be decided together" value={summary.groupedLineCount} />
          <Summary label="Stay individual" value={summary.individualLineCount} />
          <Summary label="Repair queue" value={summary.repairLineCount} />
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        A decision applies only to the ticked lines. It does not create a rule for future invoices, and a price that
        appears more than once is not approved unless you use the separate approval.
      </p>
      {message ? <p className="text-sm text-emerald-800">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {groups.length === 0 ? (
        <Card className="rounded-2xl shadow-sm ring-0">
          <CardContent className="p-6 text-sm text-muted-foreground">Nothing is waiting for review.</CardContent>
        </Card>
      ) : null}
      {sections.map((section) =>
        section.groups.length === 0 ? null : (
          <section key={section.kind} className="space-y-4">
            <h2 className="text-lg font-semibold">{KIND_LABELS[section.kind]}</h2>
            {section.groups.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                selected={selected[group.id] ?? []}
                name={names[group.id] ?? ""}
                price={prices[group.id] ?? (group.invoicePrice == null ? "" : String(group.invoicePrice))}
                unit={units[group.id] ?? group.suggestedUnit ?? ""}
                productId={products[group.id] ?? group.productId ?? ""}
                approveCurrent={approveCurrent[group.id] ?? false}
                acceptRounding={acceptRounding[group.id] ?? false}
                acknowledged={acknowledged[group.id] ?? false}
                pending={pendingId === group.id}
                onSelected={(lineIds) => setSelected((current) => ({ ...current, [group.id]: lineIds }))}
                onName={(value) => setNames((current) => ({ ...current, [group.id]: value }))}
                onPrice={(value) => setPrices((current) => ({ ...current, [group.id]: value }))}
                onUnit={(value) => setUnits((current) => ({ ...current, [group.id]: value }))}
                onProduct={(value) => setProducts((current) => ({ ...current, [group.id]: value }))}
                onApproveCurrent={(value) => setApproveCurrent((current) => ({ ...current, [group.id]: value }))}
                onAcceptRounding={(value) => setAcceptRounding((current) => ({ ...current, [group.id]: value }))}
                onAcknowledged={(value) => setAcknowledged((current) => ({ ...current, [group.id]: value }))}
                onSubmit={(decision) => submit(group, decision)}
              />
            ))}
          </section>
        )
      )}
    </div>
  );
}

function GroupCard(props: {
  group: BulkReviewGroup;
  selected: string[];
  name: string;
  price: string;
  unit: PurchaseUnit | "";
  productId: string;
  approveCurrent: boolean;
  acceptRounding: boolean;
  acknowledged: boolean;
  pending: boolean;
  onSelected: (lineIds: string[]) => void;
  onName: (value: string) => void;
  onPrice: (value: string) => void;
  onUnit: (value: PurchaseUnit | "") => void;
  onProduct: (value: string) => void;
  onApproveCurrent: (value: boolean) => void;
  onAcceptRounding: (value: boolean) => void;
  onAcknowledged: (value: boolean) => void;
  onSubmit: (decision: BulkSubmission) => void;
}) {
  const { group } = props;

  if (group.kind === "repair" && group.lines.length === 0) {
    const invoice = group.invoices[0];

    return (
      <Card className="rounded-2xl shadow-sm ring-0">
        <CardContent className="space-y-4 p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{group.supplierName}</p>
            <h3 className="text-base font-semibold">{group.title}</h3>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <Fact label="Subtotal" value={group.subtotal == null ? "Not extracted" : formatGbp(group.subtotal)} />
            <Fact label="VAT" value={group.vat == null ? "Not extracted" : formatGbp(group.vat)} />
            <Fact label="Invoice total" value={group.total == null ? "Not extracted" : formatGbp(group.total)} />
          </dl>
          {group.warnings.length > 0 ? (
            <ul className="space-y-1 text-sm text-amber-950">
              {group.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-sm text-muted-foreground">{group.proposedAction}</p>
          {invoice ? (
            <Link href={`/admin/materials/invoices/${invoice.id}`} className="text-sm font-medium underline-offset-4 hover:underline">
              Open invoice {invoice.number ?? ""}
            </Link>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  const guidance = purchaseUnitGuidance({
    statedUnit: group.statedUnit,
    unit: props.unit || group.purchaseUnit,
    widthMm: group.widthMm,
    heightMm: group.heightMm,
    lengthMm: group.lengthMm,
    price: Number(props.price) || group.invoicePrice,
  });

  function toggle(lineId: string, checked: boolean) {
    props.onSelected(
      checked ? [...props.selected, lineId] : props.selected.filter((id) => id !== lineId)
    );
  }

  return (
    <Card className="rounded-2xl shadow-sm ring-0">
      <CardContent className="space-y-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{group.supplierName}</p>
            <h3 className="text-base font-semibold">{group.title}</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            {group.invoiceCount} {group.invoiceCount === 1 ? "invoice" : "invoices"} · {group.lineCount}{" "}
            {group.lineCount === 1 ? "line" : "lines"}
          </p>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Fact label="Invoices" value={group.invoices.map((item) => `${item.number ?? "No number"} (${item.date ?? "no date"})`).join(", ") || "No lines"} />
          <Fact label="SKU" value={group.sku ?? "Not extracted"} />
          <Fact label="Size" value={group.dimensions ?? "Not extracted"} />
          <Fact
            label="Unit"
            value={
              group.statedUnit ??
              (group.purchaseUnit
                ? PURCHASE_UNIT_LABELS[group.purchaseUnit]
                : group.suggestedUnit
                  ? `${PURCHASE_UNIT_LABELS[group.suggestedUnit]} suggested`
                  : "Not stated")
            }
          />
          <Fact label="Catalogue material" value={group.catalogueMaterial ?? "None selected"} />
          <Fact
            label="Approved price"
            value={
              group.cataloguePrice == null
                ? "None"
                : `${formatGbp(group.cataloguePrice)}${group.purchaseUnit ? ` per ${PURCHASE_UNIT_LABELS[group.purchaseUnit].toLowerCase()}` : ""}`
            }
          />
          <Fact label="Invoice price" value={group.invoicePrice == null ? "See the lines" : formatGbp(group.invoicePrice)} />
          <Fact label="Proposed action" value={group.proposedAction} />
        </dl>
        {group.warnings.length > 0 ? (
          <ul className="space-y-1 text-sm text-amber-950">
            {group.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
        {group.similarMaterials.length > 0 ? (
          <p className="text-sm">
            Similar catalogue materials: {group.similarMaterials.map((material) => material.name).join(", ")}.
          </p>
        ) : null}
        <details>
          <summary className="cursor-pointer text-sm font-medium">Invoice lines</summary>
          <div className="mt-3 space-y-2">
            {group.lines.length === 0 ? <p className="text-sm text-muted-foreground">This invoice has no lines.</p> : null}
            {group.lines.map((line) => (
              <label key={line.id} className="flex gap-3 rounded-xl border border-border/70 p-3 text-sm">
                {group.canApply ? (
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={props.selected.includes(line.id)}
                    onChange={(event) => toggle(line.id, event.target.checked)}
                  />
                ) : null}
                <span>
                  <span className="font-medium">{line.invoiceNumber ?? "No number"}</span>
                  <span className="text-muted-foreground"> · {line.invoiceDate ?? "no date"}</span>
                  <span className="block">{line.description}</span>
                  <span className="text-muted-foreground">
                    {line.sku ? `SKU ${line.sku} · ` : ""}
                    {line.quantity ?? "no qty"} {line.statedUnit ?? "no unit"} ·{" "}
                    {line.unitPrice == null ? "no price" : formatGbp(line.unitPrice)}
                    {line.olderThanCurrentPrice ? " · older than the current price" : ""}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </details>
        {group.kind === "charge" ? (
          <Button disabled={props.pending} onClick={() => props.onSubmit({ action: "ignore_charges" })}>
            Confirm selected lines are non-material charges
          </Button>
        ) : null}
        {group.kind === "existing_product" ? (
          <div className="flex flex-wrap items-end gap-3">
            {group.choices.length > 1 ? (
              <label className="text-sm">
                Catalogue product
                <select
                  className="mt-1 block rounded-lg border border-border bg-background px-3 py-2"
                  value={props.productId}
                  onChange={(event) => props.onProduct(event.target.value)}
                >
                  <option value="">Choose one</option>
                  {group.choices.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.materialName} · {choice.dimensions} · {PURCHASE_UNIT_LABELS[choice.purchaseUnit]}
                      {choice.currentPrice == null ? "" : ` · ${formatGbp(choice.currentPrice)}`}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="text-sm">
                {group.choices[0]
                  ? `${group.choices[0].materialName}, ${group.choices[0].dimensions}, ${PURCHASE_UNIT_LABELS[group.choices[0].purchaseUnit].toLowerCase()}${group.choices[0].currentPrice == null ? "" : `, ${formatGbp(group.choices[0].currentPrice)}`}`
                  : "No catalogue product"}
              </p>
            )}
            <Button
              disabled={props.pending || !props.productId}
              onClick={() => props.onSubmit({ action: "confirm_product", productId: props.productId })}
            >
              Confirm this product for the selected lines
            </Button>
          </div>
        ) : null}
        {group.kind === "rounding" ? (
          <div className="space-y-3 rounded-xl border border-border p-4">
            <p className="font-medium">Record the rounding difference</p>
            <p className="text-sm text-muted-foreground">
              Saves the 1p or 2p difference on the review record. The quantity, unit price, line total, and invoice totals stay as extracted.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={props.acceptRounding}
                onChange={(event) => props.onAcceptRounding(event.target.checked)}
              />
              I have checked this 1p or 2p difference.
            </label>
            <Button
              disabled={props.pending || !props.acceptRounding}
              onClick={() => props.onSubmit({ action: "accept_rounding", acceptRounding: true })}
            >
              Record the rounding difference
            </Button>
          </div>
        ) : null}
        {group.kind === "historical_price" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-border p-4">
              <p className="font-medium">Record a historical price</p>
              <p className="text-sm text-muted-foreground">
                Saves this invoice price in the historical record. The current approved price
                {group.cataloguePrice == null ? " stays as it is." : ` of ${formatGbp(group.cataloguePrice)} stays as it is.`}
              </p>
              <Button
                disabled={props.pending}
                variant="outline"
                onClick={() => props.onSubmit({ action: "keep_historical_price" })}
              >
                Record historical price only
              </Button>
            </div>
            <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
              <p className="font-medium">Approve a new current price</p>
              <p className="text-sm">
                This is a separate decision. It adds one new approved price, and that price becomes the current catalogue price.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={props.approveCurrent}
                  onChange={(event) => props.onApproveCurrent(event.target.checked)}
                />
                I am approving a new current price.
              </label>
              <Button
                disabled={props.pending || !props.approveCurrent}
                onClick={() => props.onSubmit({ action: "approve_current_price", approveCurrent: true })}
              >
                Approve as the new current price
              </Button>
            </div>
          </div>
        ) : null}
        {group.kind === "purchase_unit" ? (
          <div className="space-y-3">
            <label className="text-sm">
              Purchase unit
              <select
                className="mt-1 block rounded-lg border border-border bg-background px-3 py-2"
                value={props.unit}
                onChange={(event) => props.onUnit(event.target.value as PurchaseUnit | "")}
              >
                <option value="">Choose a unit</option>
                {PURCHASE_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {PURCHASE_UNIT_LABELS[unit]}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-sm text-muted-foreground">{guidance}</p>
            {group.suggestedUnit === "litre" ? (
              <p className="text-sm text-muted-foreground">
                Litre is suggested from the description. It is saved only when you press the button.
              </p>
            ) : null}
            <Button
              disabled={props.pending || !props.unit}
              onClick={() => props.unit && props.onSubmit({ action: "set_purchase_unit", unit: props.unit })}
            >
              Save the purchase unit
            </Button>
          </div>
        ) : null}
        {group.kind === "new_material" && group.canApply ? (
          <div className="space-y-3">
            <label className="block text-sm">
              Material name
              <input
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
                value={props.name}
                onChange={(event) => props.onName(event.target.value)}
              />
            </label>
            <label className="block text-sm">
              Opening price
              <input
                className="mt-1 w-full max-w-xs rounded-lg border border-border bg-background px-3 py-2"
                inputMode="decimal"
                value={props.price}
                onChange={(event) => props.onPrice(event.target.value)}
              />
            </label>
            <p className="text-sm text-muted-foreground">{guidance}</p>
            {group.similarMaterials.length > 0 ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={props.acknowledged}
                  onChange={(event) => props.onAcknowledged(event.target.checked)}
                />
                I have checked the similar catalogue materials.
              </label>
            ) : null}
            <Button
              disabled={props.pending || (group.similarMaterials.length > 0 && !props.acknowledged)}
              onClick={() =>
                props.onSubmit({
                  action: "create_material",
                  name: props.name,
                  openingPrice: Number(props.price),
                  acknowledgedSimilar: props.acknowledged,
                })
              }
            >
              Create the material for the selected lines
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
