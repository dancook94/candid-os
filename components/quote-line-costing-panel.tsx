"use client";

import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatGbp } from "@/lib/format-currency";
import { PURCHASE_UNIT_LABELS, type PurchaseUnit } from "@/lib/materials/units";
import type {
  QuoteMaterialCatalogItem,
  QuoteMaterialCatalogProduct,
} from "@/lib/quotes/material-catalog";
import {
  QUOTE_COST_COMPONENT_LABELS,
  QUOTE_COST_COMPONENT_TYPES,
  emptyCostComponent,
  emptyMaterialComponent,
  clearQuoteLineCost,
  estimateQuoteLineCost,
  formatPercent,
  formatRatePerSquareMetre,
  formatSquareMetres,
  formatUnitRate,
  lineProfit,
  type QuoteCostComponentType,
  type QuoteLineCostDraft,
  type QuoteMaterialComponentDraft,
  type QuoteMaterialPricingSource,
  type QuoteProfitFigures,
} from "@/lib/quotes/costing";

type QuoteLineCostingPanelProps = {
  clientKey: string;
  cost: QuoteLineCostDraft;
  quantity: string;
  sellExVat: number;
  isOptional: boolean;
  materials: QuoteMaterialCatalogItem[];
  disabled: boolean;
  onChange: (cost: QuoteLineCostDraft) => void;
};

const PRICING_LABELS: Record<QuoteMaterialPricingSource, string> = {
  catalogue: "Catalogue rate",
  manual: "Manual amount",
  custom: "Custom rate",
};

function statusLabel(state: "unset" | "incomplete" | "complete", totalCost: number | null) {
  if (state === "complete" && totalCost != null) {
    return formatGbp(totalCost);
  }

  if (state === "unset") {
    return "No costing";
  }

  return "Incomplete";
}

function unitLabel(unit: string) {
  if (unit in PURCHASE_UNIT_LABELS) {
    return PURCHASE_UNIT_LABELS[unit as PurchaseUnit].toLowerCase();
  }

  return "unit";
}

function draftFromApprovedProduct(
  material: QuoteMaterialCatalogItem,
  product: QuoteMaterialCatalogProduct
): QuoteMaterialComponentDraft {
  const base = {
    sourceKind: "approved_material" as const,
    materialId: material.id,
    productId: product.id,
    priceId: product.currentPriceId,
    materialName: material.name,
    supplierName: product.supplierName,
    purchaseUnit: product.currentPriceUnit ?? "",
    refreshRate: true,
    rateSource: "current" as const,
  };

  if (product.currentRatePerSqm != null) {
    return emptyMaterialComponent({
      ...base,
      costBasis: "area",
      pricingSource: "catalogue",
      rate: String(product.currentRatePerSqm),
      inheritDimensions: true,
      inheritQuantity: true,
    });
  }

  if (
    product.currentPrice != null &&
    (product.currentPriceUnit === "unit" || product.currentPriceUnit === "pack")
  ) {
    return emptyMaterialComponent({
      ...base,
      costBasis: "consumption",
      pricingSource: "catalogue",
      rate: String(product.currentPrice),
      inheritDimensions: false,
      inheritQuantity: false,
      quantity: "1",
    });
  }

  return emptyMaterialComponent({
    ...base,
    costBasis: "manual",
    pricingSource: "manual",
    refreshRate: false,
    rate: "",
    rateSource: "saved",
    inheritDimensions: false,
    inheritQuantity: false,
  });
}

export function QuoteLineCostingPanel({
  clientKey,
  cost,
  quantity,
  sellExVat,
  isOptional,
  materials,
  disabled,
  onChange,
}: QuoteLineCostingPanelProps) {
  const [search, setSearch] = useState("");
  const [costingOpen, setCostingOpen] = useState(false);
  const parsedQuantity = Number.parseFloat(quantity) || 0;
  const estimate = estimateQuoteLineCost({ cost, quantity: parsedQuantity });
  const profit = lineProfit(sellExVat, estimate);
  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (query.length < 1) {
      return [];
    }

    return materials.filter((material) => material.searchText.includes(query)).slice(0, 8);
  }, [materials, search]);

  function updateMaterial(materialKey: string, patch: Partial<QuoteMaterialComponentDraft>) {
    onChange({
      ...cost,
      materials: cost.materials.map((material) =>
        material.clientKey === materialKey ? { ...material, ...patch } : material
      ),
    });
  }

  function addMaterial(material: QuoteMaterialComponentDraft) {
    onChange({ ...cost, cleared: false, materials: [...cost.materials, material] });
  }

  function chooseMaterial(material: QuoteMaterialCatalogItem) {
    const product =
      material.products.find((entry) => entry.isPreferred) ?? material.products[0] ?? null;

    if (!product) {
      return;
    }

    addMaterial(draftFromApprovedProduct(material, product));
    setSearch("");
  }

  return (
    <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50">
      <button
        type="button"
        aria-expanded={costingOpen}
        onClick={() => setCostingOpen((open) => !open)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-sm"
      >
        <span className="font-medium text-neutral-950">Internal costing</span>
        <span
          className={
            estimate.state === "complete"
              ? "text-neutral-700"
              : "rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900"
          }
        >
          {statusLabel(estimate.state, estimate.totalCost)}
        </span>
      </button>

      {costingOpen ? (
      <div className="space-y-4 border-t border-neutral-200 px-3 py-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`line-width-${clientKey}`} className="text-xs">
              Finished width (mm)
            </Label>
            <Input
              id={`line-width-${clientKey}`}
              type="number"
              min={0}
              step="1"
              value={cost.defaultFinishedWidthMm}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...cost, defaultFinishedWidthMm: event.target.value })
              }
              className="h-8 bg-white"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`line-height-${clientKey}`} className="text-xs">
              Finished height (mm)
            </Label>
            <Input
              id={`line-height-${clientKey}`}
              type="number"
              min={0}
              step="1"
              value={cost.defaultFinishedHeightMm}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...cost, defaultFinishedHeightMm: event.target.value })
              }
              className="h-8 bg-white"
            />
          </div>
        </div>
        <p className="text-xs text-neutral-500">
          Materials can use this size and the line quantity, or their own.
        </p>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-neutral-700">Materials</p>
            {!disabled && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    addMaterial(
                      emptyMaterialComponent({
                        sourceKind: "custom_material",
                        costBasis: "area",
                        pricingSource: "custom",
                        rateSource: "custom",
                        inheritDimensions: true,
                        inheritQuantity: true,
                      })
                    )
                  }
                  className="text-xs font-medium text-neutral-700 hover:text-neutral-950"
                >
                  Add custom material
                </button>
                <button
                  type="button"
                  onClick={() =>
                    addMaterial(
                      emptyMaterialComponent({
                        sourceKind: "custom_material",
                        costBasis: "manual",
                        pricingSource: "manual",
                        materialName: "",
                        inheritDimensions: false,
                        inheritQuantity: false,
                      })
                    )
                  }
                  className="text-xs font-medium text-neutral-700 hover:text-neutral-950"
                >
                  Add manual amount
                </button>
              </div>
            )}
          </div>

          {cost.materials.length === 0 && (
            <p className="text-sm text-neutral-600">
              No materials saved. This line stays incomplete until a material cost is entered.
              An empty list is not treated as zero.
            </p>
          )}

          {cost.materials.map((material, index) => {
            const materialEstimate = estimate.materials.find(
              (entry) => entry.clientKey === material.clientKey
            );
            const catalogMaterial =
              materials.find((entry) => entry.id === material.materialId) ?? null;
            const selectedProduct =
              catalogMaterial?.products.find((product) => product.id === material.productId) ??
              null;

            return (
              <MaterialCard
                key={material.clientKey}
                index={index}
                material={material}
                estimate={materialEstimate}
                catalogMaterial={catalogMaterial}
                selectedProduct={selectedProduct}
                disabled={disabled}
                onChange={(patch) => updateMaterial(material.clientKey, patch)}
                onRemove={() =>
                  onChange({
                    ...cost,
                    materials: cost.materials.filter(
                      (entry) => entry.clientKey !== material.clientKey
                    ),
                  })
                }
              />
            );
          })}

          {!disabled && (
            <div className="space-y-1.5">
              <Label htmlFor={`material-search-${clientKey}`} className="text-xs">
                Add approved material
              </Label>
              <Input
                id={`material-search-${clientKey}`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, specification, or supplier"
                className="h-8 bg-white"
              />
              {matches.length > 0 && (
                <ul className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                  {matches.map((material) => {
                    const preferred = material.products.find((product) => product.isPreferred);
                    const rate = preferred?.currentRatePerSqm;
                    return (
                      <li key={material.id}>
                        <button
                          type="button"
                          onClick={() => chooseMaterial(material)}
                          className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-neutral-50"
                        >
                          <span className="text-sm text-neutral-950">{material.name}</span>
                          <span className="text-xs text-neutral-500">
                            {[
                              material.specification,
                              preferred?.supplierName,
                              rate == null
                                ? preferred?.currentPriceUnit === "unit" ||
                                  preferred?.currentPriceUnit === "pack"
                                  ? "Unit price"
                                  : "No £/m² price"
                                : formatRatePerSquareMetre(rate),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        {estimate.state === "incomplete" && estimate.reason && (
          <p className="text-sm text-amber-900">{estimate.reason}</p>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-neutral-700">Production costs</p>
            {!disabled && (
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...cost,
                    cleared: false,
                    components: [...cost.components, emptyCostComponent()],
                  })
                }
                className="text-xs font-medium text-neutral-700 hover:text-neutral-950"
              >
                Add cost
              </button>
            )}
          </div>
          {cost.components.map((component, index) => (
            <div
              key={component.clientKey}
              className="grid gap-2 rounded-lg border border-neutral-200 bg-white p-2 sm:grid-cols-[140px_minmax(0,1fr)_90px_100px_auto]"
            >
              <select
                aria-label={`Cost type ${index + 1}`}
                value={component.componentType}
                disabled={disabled}
                onChange={(event) => {
                  const next = [...cost.components];
                  next[index] = {
                    ...component,
                    componentType: event.target.value as QuoteCostComponentType,
                  };
                  onChange({ ...cost, components: next });
                }}
                className="h-8 rounded-lg border border-neutral-300 bg-white px-2 text-sm"
              >
                {QUOTE_COST_COMPONENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {QUOTE_COST_COMPONENT_LABELS[type]}
                  </option>
                ))}
              </select>
              <Input
                aria-label={`Cost description ${index + 1}`}
                value={component.description}
                disabled={disabled}
                placeholder="Description"
                onChange={(event) => {
                  const next = [...cost.components];
                  next[index] = { ...component, description: event.target.value };
                  onChange({ ...cost, components: next });
                }}
                className="h-8"
              />
              <Input
                aria-label={
                  component.componentType === "labour"
                    ? `Hours ${index + 1}`
                    : `Quantity ${index + 1}`
                }
                type="number"
                min={0}
                step="0.01"
                value={component.quantity}
                disabled={disabled}
                placeholder={component.componentType === "labour" ? "Hours" : "Qty"}
                onChange={(event) => {
                  const next = [...cost.components];
                  next[index] = { ...component, quantity: event.target.value };
                  onChange({ ...cost, components: next });
                }}
                className="h-8"
              />
              <Input
                aria-label={`Unit cost ${index + 1}`}
                type="number"
                min={0}
                step="0.01"
                value={component.unitCost}
                disabled={disabled}
                placeholder="£ each"
                onChange={(event) => {
                  const next = [...cost.components];
                  next[index] = { ...component, unitCost: event.target.value };
                  onChange({ ...cost, components: next });
                }}
                className="h-8"
              />
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove cost ${index + 1}`}
                  onClick={() =>
                    onChange({
                      ...cost,
                      components: cost.components.filter(
                        (entry) => entry.clientKey !== component.clientKey
                      ),
                    })
                  }
                  className="h-8 px-2 text-xs text-neutral-500 hover:text-neutral-950"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

        <dl className="grid gap-2 border-t border-neutral-200 pt-3 text-sm sm:grid-cols-2">
          <MoneyRow label="Selling price ex VAT" value={formatGbp(sellExVat)} />
          <MoneyRow
            label="Material cost"
            value={estimate.materialCost == null ? "Incomplete" : formatGbp(estimate.materialCost)}
          />
          <MoneyRow label="Production costs" value={formatGbp(estimate.additionalCost)} />
          <MoneyRow
            label="Total estimated cost"
            value={estimate.totalCost == null ? "Incomplete" : formatGbp(estimate.totalCost)}
          />
          <MoneyRow
            label="Gross profit"
            value={profit.profit == null ? "Incomplete" : formatGbp(profit.profit)}
          />
          <MoneyRow label="Gross margin" value={formatPercent(profit.marginPercent)} />
        </dl>
        {isOptional && (
          <p className="text-xs text-neutral-500">
            This optional line is excluded from the quotation profitability.
          </p>
        )}
        {cost.materials.length > 0 && !disabled && (
          <button
            type="button"
            onClick={() => onChange(clearQuoteLineCost())}
            className="text-xs text-neutral-500 hover:text-neutral-950"
          >
            Clear costing
          </button>
        )}
      </div>
      ) : null}
    </div>
  );
}

function MaterialCard({
  index,
  material,
  estimate,
  catalogMaterial,
  selectedProduct,
  disabled,
  onChange,
  onRemove,
}: {
  index: number;
  material: QuoteMaterialComponentDraft;
  estimate:
    | {
        state: "incomplete" | "complete";
        areaSqm: number | null;
        costedAreaSqm: number | null;
        materialCost: number | null;
        reason: string | null;
      }
    | undefined;
  catalogMaterial: QuoteMaterialCatalogItem | null;
  selectedProduct: QuoteMaterialCatalogProduct | null;
  disabled: boolean;
  onChange: (patch: Partial<QuoteMaterialComponentDraft>) => void;
  onRemove: () => void;
}) {
  const savedRate = Number(material.rate);
  const currentCatalogueRate =
    material.costBasis === "consumption"
      ? selectedProduct?.currentPrice ?? null
      : selectedProduct?.currentRatePerSqm ?? null;
  const showCurrentOffer =
    material.pricingSource === "catalogue" &&
    material.rateSource === "saved" &&
    !material.refreshRate &&
    currentCatalogueRate != null &&
    Number.isFinite(savedRate) &&
    currentCatalogueRate !== savedRate;
  const rateLabel =
    material.costBasis === "consumption"
      ? formatUnitRate(savedRate, unitLabel(material.purchaseUnit))
      : formatRatePerSquareMetre(savedRate);

  function useCurrentRate() {
    if (!selectedProduct?.currentPriceId || currentCatalogueRate == null) {
      return;
    }

    onChange({
      priceId: selectedProduct.currentPriceId,
      rate: String(currentCatalogueRate),
      rateSource: "current",
      refreshRate: true,
    });
  }

  function chooseProduct(productId: string) {
    const product = catalogMaterial?.products.find((entry) => entry.id === productId);

    if (!product) {
      return;
    }

    const next = draftFromApprovedProduct(
      catalogMaterial ?? {
        id: material.materialId ?? "",
        name: material.materialName,
        specification: "",
        purchaseFormat: "",
        searchText: "",
        products: [],
      },
      product
    );
    onChange({
      productId: next.productId,
      priceId: next.priceId,
      supplierName: next.supplierName,
      purchaseUnit: next.purchaseUnit,
      costBasis: material.savedId ? material.costBasis : next.costBasis,
      pricingSource: material.savedId ? material.pricingSource : next.pricingSource,
      rate: next.rate,
      rateSource: "current",
      refreshRate: true,
    });
  }

  return (
    <div className="relative z-10 space-y-2 rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-neutral-950">
            {material.materialName || `Material ${index + 1}`}
          </p>
          <p className="text-xs text-neutral-500">
            {material.supplierName || "No supplier"}
            {selectedProduct?.isPreferred ? " · preferred" : ""}
          </p>
        </div>
        <span
          className={
            material.pricingSource === "manual"
              ? "rounded-md bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-950"
              : "rounded-md bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-700"
          }
        >
          {PRICING_LABELS[material.pricingSource]}
        </span>
      </div>

      {material.pricingSource === "catalogue" && material.rate.trim() !== "" && (
        <p className="text-sm text-neutral-950">
          {material.refreshRate ? "Will use the current approved rate on save" : "Saved rate"}{" "}
          {Number.isFinite(savedRate) ? rateLabel : ""}
        </p>
      )}
      {showCurrentOffer && currentCatalogueRate != null && (
        <div className="relative z-20 space-y-1">
          <p className="text-xs text-neutral-500">
            Current approved rate{" "}
            {material.costBasis === "consumption"
              ? formatUnitRate(currentCatalogueRate, unitLabel(material.purchaseUnit))
              : formatRatePerSquareMetre(currentCatalogueRate)}
          </p>
          {!disabled && (
            <button
              type="button"
              aria-label={`Use current rate for ${material.materialName || "this material"}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                useCurrentRate();
              }}
              className="relative z-20 inline-flex items-center rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-950 shadow-sm"
            >
              Use current rate
            </button>
          )}
        </div>
      )}
      {material.pricingSource === "manual" && (
        <p className="text-xs text-sky-950">
          This is a manual amount. It is not an approved catalogue rate.
        </p>
      )}

      {!material.savedId && material.pricingSource === "custom" && (
        <div className="space-y-1.5">
          <Label htmlFor={`basis-${material.clientKey}`} className="text-xs">
            How this material is costed
          </Label>
          <select
            id={`basis-${material.clientKey}`}
            value={material.costBasis}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                costBasis: event.target.value === "consumption" ? "consumption" : "area",
                inheritDimensions: event.target.value !== "consumption",
                inheritQuantity: event.target.value !== "consumption",
              })
            }
            className="h-8 w-full rounded-lg border border-neutral-300 bg-white px-2 text-sm"
          >
            <option value="area">Finished area, plus 10% wastage</option>
            <option value="consumption">Quantity × unit cost</option>
          </select>
        </div>
      )}

      {material.sourceKind === "custom_material" && material.costBasis !== "manual" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`custom-name-${material.clientKey}`} className="text-xs">
              Material name
            </Label>
            <Input
              id={`custom-name-${material.clientKey}`}
              value={material.materialName}
              disabled={disabled}
              onChange={(event) => onChange({ materialName: event.target.value })}
              className="h-8"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`custom-rate-${material.clientKey}`} className="text-xs">
              {material.costBasis === "consumption" ? "Cost per unit" : "Cost per m²"}
            </Label>
            <Input
              id={`custom-rate-${material.clientKey}`}
              type="number"
              min={0}
              step="0.0001"
              value={material.rate}
              disabled={disabled}
              onChange={(event) =>
                onChange({ rate: event.target.value, rateSource: "custom", refreshRate: false })
              }
              className="h-8"
            />
          </div>
        </div>
      )}

      {material.costBasis === "manual" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`manual-name-${material.clientKey}`} className="text-xs">
              Name
            </Label>
            <Input
              id={`manual-name-${material.clientKey}`}
              value={material.materialName}
              disabled={disabled}
              placeholder="Packaging, special finishing, other materials"
              onChange={(event) => onChange({ materialName: event.target.value })}
              className="h-8"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`manual-${material.clientKey}`} className="text-xs">
              Manual amount
            </Label>
            <Input
              id={`manual-${material.clientKey}`}
              type="number"
              min={0}
              step="0.01"
              value={material.manualMaterialCost}
              disabled={disabled}
              placeholder="Leave blank if unknown"
              onChange={(event) =>
                onChange({
                  manualMaterialCost: event.target.value,
                  confirmManualAmount: material.savedId != null,
                })
              }
              className="h-8"
            />
            <p className="text-xs text-neutral-500">Enter 0 for a genuine no-cost amount.</p>
          </div>
        </div>
      )}

      {catalogMaterial && catalogMaterial.products.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor={`supplier-${material.clientKey}`} className="text-xs">
            Supplier for this material
          </Label>
          <select
            id={`supplier-${material.clientKey}`}
            value={material.productId ?? ""}
            disabled={disabled}
            onChange={(event) => chooseProduct(event.target.value)}
            className="h-8 w-full rounded-lg border border-neutral-300 bg-white px-2 text-sm disabled:opacity-50"
          >
            {catalogMaterial.products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.supplierName}
                {product.isPreferred ? " (preferred)" : ""}
                {product.supplierSku ? ` · ${product.supplierSku}` : ""}
              </option>
            ))}
          </select>
          <p className="text-xs text-neutral-500">
            Choosing another supplier refreshes this material to that supplier&apos;s current rate.
          </p>
        </div>
      )}

      {material.costBasis === "area" && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-neutral-700">
            <input
              type="checkbox"
              checked={material.inheritDimensions}
              disabled={disabled}
              onChange={(event) => onChange({ inheritDimensions: event.target.checked })}
            />
            Use the line size
          </label>
          {!material.inheritDimensions && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                aria-label={`Material ${index + 1} width`}
                type="number"
                min={0}
                step="1"
                value={material.finishedWidthMm}
                disabled={disabled}
                placeholder="Width mm"
                onChange={(event) => onChange({ finishedWidthMm: event.target.value })}
                className="h-8"
              />
              <Input
                aria-label={`Material ${index + 1} height`}
                type="number"
                min={0}
                step="1"
                value={material.finishedHeightMm}
                disabled={disabled}
                placeholder="Height mm"
                onChange={(event) => onChange({ finishedHeightMm: event.target.value })}
                className="h-8"
              />
            </div>
          )}
        </div>
      )}

      {material.costBasis !== "manual" && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-neutral-700">
            <input
              type="checkbox"
              checked={material.inheritQuantity}
              disabled={disabled}
              onChange={(event) => onChange({ inheritQuantity: event.target.checked })}
            />
            Use the line quantity
          </label>
          {!material.inheritQuantity && (
            <Input
              aria-label={`Material ${index + 1} quantity`}
              type="number"
              min={0}
              step="0.0001"
              value={material.quantity}
              disabled={disabled}
              placeholder={
                material.costBasis === "consumption"
                  ? `Quantity (${unitLabel(material.purchaseUnit)})`
                  : "Quantity"
              }
              onChange={(event) => onChange({ quantity: event.target.value })}
              className="h-8 max-w-xs"
            />
          )}
        </div>
      )}

      {estimate?.state === "complete" && estimate.areaSqm != null && estimate.costedAreaSqm != null && (
        <p className="text-xs text-neutral-600">
          {formatSquareMetres(estimate.areaSqm)} plus 10% wastage ={" "}
          {formatSquareMetres(estimate.costedAreaSqm)} ·{" "}
          {estimate.materialCost == null ? "Incomplete" : formatGbp(estimate.materialCost)}
        </p>
      )}
      {estimate?.state === "complete" && estimate.areaSqm == null && estimate.materialCost != null && (
        <p className="text-xs text-neutral-600">{formatGbp(estimate.materialCost)}</p>
      )}
      {estimate?.state === "incomplete" && (
        <p className="text-xs text-amber-900">{estimate.reason}</p>
      )}

      {!disabled && (
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-neutral-500 hover:text-neutral-950"
        >
          Remove material
        </button>
      )}
    </div>
  );
}

function MoneyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-medium text-neutral-950">{value}</dd>
    </div>
  );
}

export function QuoteProfitabilitySummary({
  figures,
}: {
  figures: QuoteProfitFigures;
}) {
  return (
    <div className="w-full rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-neutral-950">Profitability</p>
        {figures.provisional && (
          <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
            Provisional
          </span>
        )}
      </div>
      <dl className="space-y-2 text-sm">
        <MoneyRow label="Selling price ex VAT" value={formatGbp(figures.sellExVat)} />
        <MoneyRow
          label="Estimated material cost"
          value={figures.materialCost == null ? "Incomplete" : formatGbp(figures.materialCost)}
        />
        <MoneyRow
          label="Production costs"
          value={figures.additionalCost == null ? "Incomplete" : formatGbp(figures.additionalCost)}
        />
        <MoneyRow
          label="Total estimated cost"
          value={figures.totalCost == null ? "Incomplete" : formatGbp(figures.totalCost)}
        />
        <MoneyRow
          label="Estimated gross profit"
          value={figures.profit == null ? "Incomplete" : formatGbp(figures.profit)}
        />
        <MoneyRow label="Gross margin" value={formatPercent(figures.marginPercent)} />
      </dl>
      <p className="mt-3 text-xs text-neutral-500">Optional lines are excluded.</p>
      {figures.provisional && (
        <p className="mt-1 text-xs text-amber-900">
          Profitability stays incomplete until every included line has a complete cost.
        </p>
      )}
    </div>
  );
}
