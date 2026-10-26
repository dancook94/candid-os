"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatGbp } from "@/lib/format-currency";
import { savePurchaseOrderDraft } from "@/lib/purchasing/actions";
import type { CatalogueChoice, PurchasingJobOption } from "@/lib/purchasing/draft-editor-data";
import {
  applySavedDraft,
  buildPurchaseOrderDraftPayload,
  emptyCatalogueLine,
  emptyManualLine,
  estimateDraftTotals,
  PURCHASE_ORDER_VAT_TREATMENTS,
  validateDraft,
  type EditorAllocation,
  type EditorDeliveryAllocation,
  type EditorDraft,
  type EditorLine,
  type PurchaseOrderVatTreatment,
} from "@/lib/purchasing/draft-editor";

const vatLabels: Record<PurchaseOrderVatTreatment, string> = {
  standard: "Standard",
  zero_rated: "Zero-rated",
  exempt: "Exempt",
  reverse_charge: "Reverse charge",
  outside_scope: "Outside scope",
};

type PurchaseOrderDraftEditorProps = {
  revisionId: string;
  initialDraft: EditorDraft;
  catalogue: CatalogueChoice[];
  jobs: PurchasingJobOption[];
  catalogueError: string | null;
  jobsError: string | null;
};

export function PurchaseOrderDraftEditor({
  revisionId,
  initialDraft,
  catalogue,
  jobs,
  catalogueError,
  jobsError,
}: PurchaseOrderDraftEditorProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [catalogueQuery, setCatalogueQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const submitLock = useRef(false);
  const totals = useMemo(() => estimateDraftTotals(draft), [draft]);
  const visibleCatalogue = catalogue.filter((choice) => {
    const query = catalogueQuery.trim().toLowerCase();
    if (!query) {
      return true;
    }
    return `${choice.materialName} ${choice.description} ${choice.supplierSku ?? ""}`
      .toLowerCase()
      .includes(query);
  });

  function updateLine(key: string, patch: Partial<EditorLine>) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    }));
    setSaved(false);
  }

  async function saveDraft() {
    if (submitLock.current) {
      return;
    }

    const validation = validateDraft(draft);
    if (validation) {
      setSaved(false);
      setMessage(validation);
      return;
    }

    submitLock.current = true;
    setSaving(true);
    setMessage(null);

    try {
      const result = await savePurchaseOrderDraft(
        revisionId,
        buildPurchaseOrderDraftPayload(draft)
      );
      if (!result.ok) {
        setSaved(false);
        setMessage(result.message);
        return;
      }

      setDraft((current) =>
        applySavedDraft(current, {
          supplierOrdersEmail: result.supplierOrdersEmail,
          lines: result.lines,
          deliveryAllocations: result.deliveryAllocations,
        })
      );
      setSaved(true);
      setMessage("Draft saved.");
    } finally {
      submitLock.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
        <h2 className="text-base font-semibold text-foreground">Draft details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="supplier-orders-email">Supplier orders email</Label>
            <Input
              id="supplier-orders-email"
              type="email"
              value={draft.supplierOrdersEmail}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  supplierOrdersEmail: event.target.value,
                }))
              }
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vat-treatment">VAT</Label>
            <Select
              id="vat-treatment"
              value={draft.vatTreatment}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  vatTreatment: value as PurchaseOrderVatTreatment,
                }))
              }
            >
              {PURCHASE_ORDER_VAT_TREATMENTS.map((treatment) => (
                <option key={treatment} value={treatment}>
                  {vatLabels[treatment]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="delivery-method">Delivery</Label>
            <Select
              id="delivery-method"
              value={draft.deliveryMethod}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  deliveryMethod: value === "custom" ? "custom" : "workshop",
                  deliveryAllocations:
                    current.deliveryChargeMethod === "proportional"
                      ? []
                      : current.deliveryAllocations,
                }))
              }
            >
              <option value="workshop">Workshop</option>
              <option value="custom">Custom address</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="delivery-charge">Delivery charge ex VAT</Label>
            <Input
              id="delivery-charge"
              inputMode="decimal"
              value={draft.deliveryChargeExVat}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  deliveryChargeExVat: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="delivery-charge-method">Delivery allocation</Label>
            <Select
              id="delivery-charge-method"
              value={draft.deliveryChargeMethod}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  deliveryChargeMethod: value === "manual" ? "manual" : "proportional",
                  deliveryAllocations:
                    value === "proportional" ? [] : current.deliveryAllocations,
                }))
              }
            >
              <option value="proportional">Proportional</option>
              <option value="manual">Manual</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="delivery-date">Delivery date</Label>
            <Input
              id="delivery-date"
              type="date"
              value={draft.deliveryDate}
              onChange={(event) =>
                setDraft((current) => ({ ...current, deliveryDate: event.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="delivery-country">Country</Label>
            <Input
              id="delivery-country"
              value={draft.deliveryCountry}
              onChange={(event) =>
                setDraft((current) => ({ ...current, deliveryCountry: event.target.value }))
              }
            />
          </div>
        </div>
        {draft.deliveryMethod === "custom" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="delivery-recipient"
              label="Recipient"
              value={draft.deliveryRecipient}
              onChange={(value) =>
                setDraft((current) => ({ ...current, deliveryRecipient: value }))
              }
            />
            <TextField
              id="delivery-line-1"
              label="Address line 1"
              value={draft.deliveryLine1}
              onChange={(value) => setDraft((current) => ({ ...current, deliveryLine1: value }))}
            />
            <TextField
              id="delivery-line-2"
              label="Address line 2"
              value={draft.deliveryLine2}
              onChange={(value) => setDraft((current) => ({ ...current, deliveryLine2: value }))}
            />
            <TextField
              id="delivery-city"
              label="City"
              value={draft.deliveryCity}
              onChange={(value) => setDraft((current) => ({ ...current, deliveryCity: value }))}
            />
            <TextField
              id="delivery-county"
              label="County"
              value={draft.deliveryCounty}
              onChange={(value) => setDraft((current) => ({ ...current, deliveryCounty: value }))}
            />
            <TextField
              id="delivery-postcode"
              label="Postcode"
              value={draft.deliveryPostcode}
              onChange={(value) =>
                setDraft((current) => ({ ...current, deliveryPostcode: value }))
              }
            />
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="delivery-instructions">Delivery instructions</Label>
          <Textarea
            id="delivery-instructions"
            value={draft.deliveryInstructions}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                deliveryInstructions: event.target.value,
              }))
            }
          />
        </div>
        {draft.deliveryChargeMethod === "proportional" ? (
          <p className="text-sm text-muted-foreground">
            Proportional delivery is split across jobs and stock from the goods when the draft is saved.
          </p>
        ) : (
          <DeliveryAllocations
            allocations={draft.deliveryAllocations}
            jobs={jobs}
            onChange={(deliveryAllocations) =>
              setDraft((current) => ({ ...current, deliveryAllocations }))
            }
          />
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">Line items</h2>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  lines: [...current.lines, emptyCatalogueLine(newKey())],
                }))
              }
            >
              Add catalogue line
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  lines: [...current.lines, emptyManualLine(newKey())],
                }))
              }
            >
              Add manual line
            </Button>
          </div>
        </div>
        {catalogueError ? <p className="text-sm text-destructive">{catalogueError}</p> : null}
        {jobsError ? <p className="text-sm text-destructive">{jobsError}</p> : null}
        {draft.lines.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No line items yet. Add a catalogue material or a manual line.
          </p>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="catalogue-search">Search catalogue</Label>
          <Input
            id="catalogue-search"
            value={catalogueQuery}
            onChange={(event) => setCatalogueQuery(event.target.value)}
            placeholder="Search this supplier's materials"
            autoComplete="off"
          />
        </div>
        <div className="space-y-4">
          {draft.lines.map((line, index) => (
            <LineEditor
              key={line.key}
              line={line}
              index={index}
              catalogue={catalogue}
              visibleCatalogue={visibleCatalogue}
              jobs={jobs}
              onChange={(patch) => updateLine(line.key, patch)}
              onRemove={() =>
                setDraft((current) => ({
                  ...current,
                  lines: current.lines.filter((item) => item.key !== line.key),
                }))
              }
            />
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
        <h2 className="text-base font-semibold text-foreground">Totals</h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <Total label="Goods ex VAT" value={totals.goodsExVat} />
          <Total label="Delivery ex VAT" value={totals.deliveryExVat} />
          <Total label="Subtotal ex VAT" value={totals.subtotalExVat} />
          <Total label="VAT" value={totals.vatTotal} />
          <Total label="Total including VAT" value={totals.totalIncVat} />
        </dl>
        <p className="mt-3 text-sm text-muted-foreground">
          Catalogue prices and proportional delivery are confirmed when the draft is saved.
        </p>
        {message ? (
          <p
            className={saved ? "mt-4 text-sm text-foreground" : "mt-4 text-sm text-destructive"}
            role="status"
          >
            {message}
          </p>
        ) : null}
        <Button type="button" className="mt-4" disabled={saving} onClick={() => void saveDraft()}>
          {saving ? "Saving draft…" : "Save draft"}
        </Button>
      </section>
    </div>
  );
}

function LineEditor({
  line,
  index,
  catalogue,
  visibleCatalogue,
  jobs,
  onChange,
  onRemove,
}: {
  line: EditorLine;
  index: number;
  catalogue: CatalogueChoice[];
  visibleCatalogue: CatalogueChoice[];
  jobs: PurchasingJobOption[];
  onChange: (patch: Partial<EditorLine>) => void;
  onRemove: () => void;
}) {
  const selected = catalogue.find((choice) => choice.priceId === line.priceId) ?? null;
  const quantity = Number(line.quantity);
  const price = Number(line.unitPriceExVat);
  const lineTotal =
    Number.isFinite(quantity) && Number.isFinite(price) ? Math.round(quantity * price * 100) / 100 : 0;

  return (
    <article className="space-y-4 rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">
          Line {index + 1} · {line.lineKind === "catalogue" ? "Catalogue" : "Manual"}
        </h3>
        <Button type="button" variant="outline" onClick={onRemove}>
          Remove
        </Button>
      </div>
      {line.lineKind === "catalogue" ? (
        <div className="space-y-2">
          <Label htmlFor={`catalogue-${line.key}`}>Catalogue product</Label>
          <Select
            id={`catalogue-${line.key}`}
            value={line.priceId ?? ""}
            onChange={(priceId) => {
              const choice = catalogue.find((item) => item.priceId === priceId);
              if (!choice) {
                return;
              }
              onChange({
                materialId: choice.materialId,
                productId: choice.productId,
                priceId: choice.priceId,
                description: choice.description,
                supplierSku: choice.supplierSku ?? "",
                unit: choice.unit,
                unitPriceExVat: choice.unitPriceExVat,
              });
            }}
          >
            <option value="">Choose a product</option>
            {selected && !visibleCatalogue.some((choice) => choice.priceId === selected.priceId) ? (
              <option value={selected.priceId}>{selected.description}</option>
            ) : null}
            {visibleCatalogue.map((choice) => (
              <option key={choice.priceId} value={choice.priceId}>
                {choice.materialName} · {choice.description}
                {choice.supplierSku ? ` · ${choice.supplierSku}` : ""} · {formatGbp(Number(choice.unitPriceExVat) || 0)}
              </option>
            ))}
          </Select>
          <p className="text-sm text-muted-foreground">
            {line.unit ? `${line.unit} · ` : ""}
            {line.unitPriceExVat ? `${formatGbp(Number(line.unitPriceExVat) || 0)} ex VAT` : "Price comes from the approved catalogue."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id={`description-${line.key}`}
            label="Description"
            value={line.description}
            onChange={(description) => onChange({ description })}
          />
          <TextField
            id={`sku-${line.key}`}
            label="Supplier SKU"
            value={line.supplierSku}
            onChange={(supplierSku) => onChange({ supplierSku })}
          />
          <TextField
            id={`unit-${line.key}`}
            label="Unit"
            value={line.unit}
            onChange={(unit) => onChange({ unit })}
          />
          <TextField
            id={`price-${line.key}`}
            label="Unit price ex VAT"
            value={line.unitPriceExVat}
            onChange={(unitPriceExVat) => onChange({ unitPriceExVat })}
            inputMode="decimal"
          />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id={`quantity-${line.key}`}
          label="Quantity"
          value={line.quantity}
          onChange={(quantityValue) => onChange({ quantity: quantityValue })}
          inputMode="decimal"
        />
        <div className="space-y-2">
          <Label htmlFor={`vat-${line.key}`}>Line VAT</Label>
          <Select
            id={`vat-${line.key}`}
            value={line.vatTreatment}
            onChange={(vatTreatment) => onChange({ vatTreatment })}
          >
            <option value="">Same as order</option>
            {PURCHASE_ORDER_VAT_TREATMENTS.map((treatment) => (
              <option key={treatment} value={treatment}>
                {vatLabels[treatment]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <p className="text-sm font-medium text-foreground">Line total ex VAT {formatGbp(lineTotal || 0)}</p>
      <Allocations
        allocations={line.allocations}
        jobs={jobs}
        onChange={(allocations) => onChange({ allocations })}
      />
    </article>
  );
}

function Allocations({
  allocations,
  jobs,
  onChange,
}: {
  allocations: EditorAllocation[];
  jobs: PurchasingJobOption[];
  onChange: (allocations: EditorAllocation[]) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-foreground">Allocation</h4>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              onChange([
                ...allocations,
                { key: newKey(), target: "job", jobId: "", quantity: "" },
              ])
            }
          >
            Add job
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              onChange([
                ...allocations,
                { key: newKey(), target: "stock", jobId: "", quantity: "" },
              ])
            }
          >
            Add stock
          </Button>
        </div>
      </div>
      {allocations.map((allocation) => (
        <div key={allocation.key} className="grid gap-3 sm:grid-cols-[8rem_1fr_8rem_auto]">
          <Select
            value={allocation.target}
            onChange={(target) =>
              onChange(
                allocations.map((item) =>
                  item.key === allocation.key
                    ? {
                        ...item,
                        target: target === "stock" ? "stock" : "job",
                        jobId: target === "stock" ? "" : item.jobId,
                      }
                    : item
                )
              )
            }
          >
            <option value="job">Job</option>
            <option value="stock">Stock</option>
          </Select>
          {allocation.target === "job" ? (
            <JobSelect
              jobs={jobs}
              value={allocation.jobId}
              onChange={(jobId) =>
                onChange(
                  allocations.map((item) =>
                    item.key === allocation.key ? { ...item, jobId } : item
                  )
                )
              }
            />
          ) : (
            <p className="flex items-center text-sm text-muted-foreground">Workshop stock</p>
          )}
          <div className="space-y-2">
            <Label htmlFor={`allocated-quantity-${allocation.key}`}>Quantity allocated</Label>
            <Input
              id={`allocated-quantity-${allocation.key}`}
              inputMode="decimal"
              aria-label="Quantity allocated"
              value={allocation.quantity}
              onChange={(event) =>
                onChange(
                  allocations.map((item) =>
                    item.key === allocation.key ? { ...item, quantity: event.target.value } : item
                  )
                )
              }
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange(allocations.filter((item) => item.key !== allocation.key))}
          >
            Remove
          </Button>
        </div>
      ))}
    </div>
  );
}

function DeliveryAllocations({
  allocations,
  jobs,
  onChange,
}: {
  allocations: EditorDeliveryAllocation[];
  jobs: PurchasingJobOption[];
  onChange: (allocations: EditorDeliveryAllocation[]) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">Manual delivery allocation</h3>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              onChange([
                ...allocations,
                { key: newKey(), target: "job", jobId: "", amountExVat: "0" },
              ])
            }
          >
            Add job
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              onChange([
                ...allocations,
                { key: newKey(), target: "stock", jobId: "", amountExVat: "0" },
              ])
            }
          >
            Add stock
          </Button>
        </div>
      </div>
      {allocations.map((allocation) => (
        <div key={allocation.key} className="grid gap-3 sm:grid-cols-[8rem_1fr_8rem_auto]">
          <Select
            value={allocation.target}
            onChange={(target) =>
              onChange(
                allocations.map((item) =>
                  item.key === allocation.key
                    ? {
                        ...item,
                        target: target === "stock" ? "stock" : "job",
                        jobId: target === "stock" ? "" : item.jobId,
                      }
                    : item
                )
              )
            }
          >
            <option value="job">Job</option>
            <option value="stock">Stock</option>
          </Select>
          {allocation.target === "job" ? (
            <JobSelect
              jobs={jobs}
              value={allocation.jobId}
              onChange={(jobId) =>
                onChange(
                  allocations.map((item) =>
                    item.key === allocation.key ? { ...item, jobId } : item
                  )
                )
              }
            />
          ) : (
            <p className="flex items-center text-sm text-muted-foreground">Workshop stock</p>
          )}
          <Input
            inputMode="decimal"
            aria-label="Delivery amount ex VAT"
            value={allocation.amountExVat}
            onChange={(event) =>
              onChange(
                allocations.map((item) =>
                  item.key === allocation.key
                    ? { ...item, amountExVat: event.target.value }
                    : item
                )
              )
            }
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange(allocations.filter((item) => item.key !== allocation.key))}
          >
            Remove
          </Button>
        </div>
      ))}
    </div>
  );
}

function JobSelect({
  jobs,
  value,
  onChange,
}: {
  jobs: PurchasingJobOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onChange={onChange} aria-label="Job">
      <option value="">Choose a job</option>
      {value && !jobs.some((job) => job.id === value) ? (
        <option value={value}>Saved job</option>
      ) : null}
      {jobs.map((job) => (
        <option key={job.id} value={job.id}>
          {job.reference}
          {job.projectName ? ` · ${job.projectName}` : ""}
        </option>
      ))}
    </Select>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{formatGbp(value)}</dd>
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: "decimal";
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function Select({
  id,
  value,
  onChange,
  children,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
    </select>
  );
}

function newKey() {
  return crypto.randomUUID();
}
