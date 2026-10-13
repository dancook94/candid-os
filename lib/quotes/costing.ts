import { calculateCostPerSquareMetre } from "@/lib/materials/pricing";
import type { PurchaseUnit } from "@/lib/materials/units";

export const QUOTE_WASTAGE_RATE = 0.1;

export const QUOTE_COST_COMPONENT_TYPES = [
  "printing",
  "finishing",
  "labour",
  "installation",
  "delivery",
  "outsourcing",
  "other",
] as const;

export type QuoteCostComponentType = (typeof QUOTE_COST_COMPONENT_TYPES)[number];

export const QUOTE_COST_COMPONENT_LABELS: Record<QuoteCostComponentType, string> = {
  printing: "Printing",
  finishing: "Finishing",
  labour: "Labour",
  installation: "Installation",
  delivery: "Delivery",
  outsourcing: "Outsourcing",
  other: "Other",
};

export type QuoteMaterialSourceKind = "approved_material" | "custom_material";
export type QuoteMaterialCostBasis = "area" | "consumption" | "manual";
export type QuoteMaterialPricingSource = "catalogue" | "manual" | "custom";

export type QuoteCostComponentDraft = {
  clientKey: string;
  componentType: QuoteCostComponentType;
  description: string;
  quantity: string;
  unitCost: string;
};

export type QuoteMaterialComponentDraft = {
  clientKey: string;
  savedId: string | null;
  sourceKind: QuoteMaterialSourceKind;
  costBasis: QuoteMaterialCostBasis;
  pricingSource: QuoteMaterialPricingSource;
  materialId: string | null;
  productId: string | null;
  priceId: string | null;
  materialName: string;
  supplierName: string;
  purchaseUnit: string;
  rate: string;
  rateSource: "saved" | "current" | "custom";
  refreshRate: boolean;
  inheritDimensions: boolean;
  inheritQuantity: boolean;
  finishedWidthMm: string;
  finishedHeightMm: string;
  quantity: string;
  manualMaterialCost: string;
  confirmManualAmount: boolean;
};

export type QuoteLineCostDraft = {
  defaultFinishedWidthMm: string;
  defaultFinishedHeightMm: string;
  materials: QuoteMaterialComponentDraft[];
  components: QuoteCostComponentDraft[];
  cleared?: boolean;
};

export type QuoteMaterialEstimate = {
  clientKey: string;
  state: "incomplete" | "complete";
  areaSqm: number | null;
  costedAreaSqm: number | null;
  rate: number | null;
  materialCost: number | null;
  reason: string | null;
};

export type QuoteLineEstimate = {
  state: "unset" | "incomplete" | "complete";
  areaSqm: number | null;
  costedAreaSqm: number | null;
  ratePerSqm: number | null;
  materials: QuoteMaterialEstimate[];
  materialCost: number | null;
  additionalCost: number;
  totalCost: number | null;
  reason: string | null;
};

export type QuoteProfitFigures = {
  sellExVat: number;
  materialCost: number | null;
  additionalCost: number | null;
  totalCost: number | null;
  profit: number | null;
  marginPercent: number | null;
  markupPercent: number | null;
  provisional: boolean;
};

export type DraftQuoteLineInput = {
  id?: string | null;
  title: string;
  description: string;
  quantity: number;
  unitPrice: number;
  isOptional: boolean;
  imageStoragePath: string | null;
  imageFileName: string | null;
  imageFileType: string | null;
  imageFileSize: number | null;
  cost: QuoteLineCostDraft;
};

type SavedSummaryRow = {
  id?: string | null;
  cost_kind: string;
  cost_basis?: string | null;
  material_id: string | null;
  material_supplier_product_id: string | null;
  material_price_id: string | null;
  material_name: string | null;
  supplier_name: string | null;
  rate_per_sqm: number | string | null;
  finished_width_mm: number | string | null;
  finished_height_mm: number | string | null;
  quantity?: number | string | null;
  manual_material_cost: number | string | null;
  default_finished_width_mm?: number | string | null;
  default_finished_height_mm?: number | string | null;
};

type SavedMaterialRow = {
  id: string;
  sort_order: number;
  source_kind: string;
  cost_basis: string;
  pricing_source: string;
  material_id: string | null;
  material_supplier_product_id: string | null;
  material_price_id: string | null;
  material_name: string | null;
  supplier_name: string | null;
  purchase_unit: string | null;
  snapshotted_rate: number | string | null;
  finished_width_mm: number | string | null;
  finished_height_mm: number | string | null;
  quantity: number | string | null;
  inherit_dimensions: boolean | null;
  inherit_quantity: boolean | null;
  manual_material_cost: number | string | null;
};

type SavedComponentRow = {
  component_type: string;
  description: string | null;
  quantity: number | string;
  unit_cost: number | string;
  sort_order: number;
};

export function emptyQuoteLineCost(): QuoteLineCostDraft {
  return {
    defaultFinishedWidthMm: "",
    defaultFinishedHeightMm: "",
    materials: [],
    components: [],
    cleared: false,
  };
}

export function clearQuoteLineCost(): QuoteLineCostDraft {
  return {
    ...emptyQuoteLineCost(),
    cleared: true,
  };
}

export function emptyMaterialComponent(
  partial: Partial<QuoteMaterialComponentDraft> = {}
): QuoteMaterialComponentDraft {
  return {
    clientKey: crypto.randomUUID(),
    savedId: null,
    sourceKind: "custom_material",
    costBasis: "manual",
    pricingSource: "manual",
    materialId: null,
    productId: null,
    priceId: null,
    materialName: "",
    supplierName: "",
    purchaseUnit: "",
    rate: "",
    rateSource: "custom",
    refreshRate: false,
    inheritDimensions: true,
    inheritQuantity: true,
    finishedWidthMm: "",
    finishedHeightMm: "",
    quantity: "",
    manualMaterialCost: "",
    confirmManualAmount: false,
    ...partial,
  };
}

export function cloneQuoteLineCost(cost: QuoteLineCostDraft): QuoteLineCostDraft {
  return {
    ...cost,
    materials: cost.materials.map((material) => ({
      ...material,
      clientKey: crypto.randomUUID(),
    })),
    components: cost.components.map((component) => ({
      ...component,
      clientKey: crypto.randomUUID(),
    })),
  };
}

export function detachQuoteLineCostIdentity(cost: QuoteLineCostDraft): QuoteLineCostDraft {
  const cloned = cloneQuoteLineCost(cost);

  return {
    ...cloned,
    cleared: false,
    materials: cloned.materials.map((material) => ({
      ...material,
      savedId: null,
      confirmManualAmount: false,
      refreshRate: material.pricingSource === "catalogue" ? true : material.refreshRate,
    })),
  };
}

export function emptyCostComponent(
  componentType: QuoteCostComponentType = "printing"
): QuoteCostComponentDraft {
  return {
    clientKey: crypto.randomUUID(),
    componentType,
    description: "",
    quantity: "",
    unitCost: "",
  };
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function roundRate(value: number) {
  return Math.round(value * 10000) / 10000;
}

export function roundArea(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function quoteAreaSqm(widthMm: number, heightMm: number, quantity: number) {
  return roundArea((widthMm * heightMm * quantity) / 1_000_000);
}

export function quoteCostedAreaSqm(areaSqm: number) {
  return roundArea(areaSqm * (1 + QUOTE_WASTAGE_RATE));
}

export function approvedRatePerSquareMetre(input: {
  price: number;
  priceUnit: PurchaseUnit;
  widthMm: number | null;
  heightMm: number | null;
  lengthMm: number | null;
}) {
  const rate = calculateCostPerSquareMetre(input);
  return rate == null ? null : roundRate(rate);
}

export function canEditQuoteVersion(versionStatus: string | null | undefined) {
  return versionStatus === "draft";
}

function asNumber(value: number | string | null | undefined) {
  if (value == null || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDraftNumber(value: number | null, fractionDigits: number) {
  if (value == null) {
    return "";
  }

  return value.toFixed(fractionDigits).replace(/\.?0+$/, "");
}

function isComponentType(value: string): value is QuoteCostComponentType {
  return (QUOTE_COST_COMPONENT_TYPES as readonly string[]).includes(value);
}

function isSourceKind(value: string): value is QuoteMaterialSourceKind {
  return value === "approved_material" || value === "custom_material";
}

function isCostBasis(value: string): value is QuoteMaterialCostBasis {
  return value === "area" || value === "consumption" || value === "manual";
}

function isPricingSource(value: string): value is QuoteMaterialPricingSource {
  return value === "catalogue" || value === "manual" || value === "custom";
}

function pricingSourceFor(material: {
  sourceKind: QuoteMaterialSourceKind;
  costBasis: QuoteMaterialCostBasis;
}): QuoteMaterialPricingSource {
  if (material.costBasis === "manual") {
    return "manual";
  }

  return material.sourceKind === "approved_material" ? "catalogue" : "custom";
}

function draftMaterialFromSaved(row: SavedMaterialRow): QuoteMaterialComponentDraft | null {
  if (!isSourceKind(row.source_kind) || !isCostBasis(row.cost_basis)) {
    return null;
  }

  const pricingSource = isPricingSource(row.pricing_source)
    ? row.pricing_source
    : pricingSourceFor({ sourceKind: row.source_kind, costBasis: row.cost_basis });

  return emptyMaterialComponent({
    savedId: row.id,
    sourceKind: row.source_kind,
    costBasis: row.cost_basis,
    pricingSource,
    materialId: row.material_id,
    productId: row.material_supplier_product_id,
    priceId: row.material_price_id,
    materialName: row.material_name ?? "",
    supplierName: row.supplier_name ?? "",
    purchaseUnit: row.purchase_unit ?? "",
    rate: formatDraftNumber(asNumber(row.snapshotted_rate), 4),
    rateSource: row.source_kind === "custom_material" ? "custom" : "saved",
    refreshRate: false,
    inheritDimensions: row.inherit_dimensions ?? true,
    inheritQuantity: row.inherit_quantity ?? true,
    finishedWidthMm: formatDraftNumber(asNumber(row.finished_width_mm), 2),
    finishedHeightMm: formatDraftNumber(asNumber(row.finished_height_mm), 2),
    quantity: formatDraftNumber(asNumber(row.quantity), 4),
    manualMaterialCost: formatDraftNumber(asNumber(row.manual_material_cost), 2),
    confirmManualAmount: false,
  });
}

function legacyMaterialFromSummary(summary: SavedSummaryRow): QuoteMaterialComponentDraft | null {
  if (summary.cost_kind === "service" || summary.cost_basis === "manual") {
    return emptyMaterialComponent({
      savedId: summary.id ?? null,
      sourceKind: "custom_material",
      costBasis: "manual",
      pricingSource: "manual",
      materialName: summary.material_name?.trim() || (summary.cost_kind === "service" ? "Service" : ""),
      manualMaterialCost: formatDraftNumber(asNumber(summary.manual_material_cost), 2),
      inheritDimensions: false,
      inheritQuantity: false,
    });
  }

  if (summary.cost_kind !== "approved_material" && summary.cost_kind !== "custom_material") {
    return null;
  }

  return emptyMaterialComponent({
    savedId: summary.id ?? null,
    sourceKind: summary.cost_kind,
    costBasis: "area",
    pricingSource: summary.cost_kind === "approved_material" ? "catalogue" : "custom",
    materialId: summary.material_id,
    productId: summary.material_supplier_product_id,
    priceId: summary.material_price_id,
    materialName: summary.material_name ?? "",
    supplierName: summary.supplier_name ?? "",
    purchaseUnit: "square_metre",
    rate: formatDraftNumber(asNumber(summary.rate_per_sqm), 4),
    rateSource: summary.cost_kind === "custom_material" ? "custom" : "saved",
    refreshRate: false,
    inheritDimensions: false,
    inheritQuantity: true,
    finishedWidthMm: formatDraftNumber(asNumber(summary.finished_width_mm), 2),
    finishedHeightMm: formatDraftNumber(asNumber(summary.finished_height_mm), 2),
    quantity: formatDraftNumber(asNumber(summary.quantity), 4),
  });
}

export function costDraftFromSnapshot(input: {
  summary: SavedSummaryRow;
  materials?: SavedMaterialRow[];
  components: SavedComponentRow[];
}): QuoteLineCostDraft {
  const savedMaterials = [...(input.materials ?? [])].sort(
    (left, right) => left.sort_order - right.sort_order
  );
  const materials =
    input.summary.cost_kind === "composite" || savedMaterials.length > 0
      ? savedMaterials.flatMap((row) => {
          const material = draftMaterialFromSaved(row);
          return material ? [material] : [];
        })
      : [legacyMaterialFromSummary(input.summary)].flatMap((material) =>
          material ? [material] : []
        );

  return {
    defaultFinishedWidthMm: formatDraftNumber(
      asNumber(input.summary.default_finished_width_mm ?? input.summary.finished_width_mm),
      2
    ),
    defaultFinishedHeightMm: formatDraftNumber(
      asNumber(input.summary.default_finished_height_mm ?? input.summary.finished_height_mm),
      2
    ),
    materials,
    components: [...input.components]
      .sort((left, right) => left.sort_order - right.sort_order)
      .flatMap((component) => {
        if (!isComponentType(component.component_type)) {
          return [];
        }

        const quantity = asNumber(component.quantity);
        const unitCost = asNumber(component.unit_cost);

        return [
          {
            clientKey: crypto.randomUUID(),
            componentType: component.component_type,
            description: component.description ?? "",
            quantity: quantity == null ? "" : formatDraftNumber(quantity, 2),
            unitCost: unitCost == null ? "" : formatDraftNumber(unitCost, 2),
          },
        ];
      }),
  };
}

function componentIsBlank(component: QuoteCostComponentDraft) {
  return (
    component.description.trim() === "" &&
    component.quantity.trim() === "" &&
    component.unitCost.trim() === ""
  );
}

function parseComponents(components: QuoteCostComponentDraft[]) {
  const rows: Array<{
    component_type: QuoteCostComponentType;
    description: string | null;
    quantity: number;
    unit_cost: number;
  }> = [];
  let additionalCost = 0;

  for (const component of components) {
    if (componentIsBlank(component)) {
      continue;
    }

    const quantity = Number(component.quantity);
    const unitCost = Number(component.unitCost);

    if (
      component.quantity.trim() === "" ||
      component.unitCost.trim() === "" ||
      !Number.isFinite(quantity) ||
      !Number.isFinite(unitCost) ||
      quantity <= 0 ||
      unitCost < 0
    ) {
      return {
        ok: false as const,
        error: `${QUOTE_COST_COMPONENT_LABELS[component.componentType]} needs a quantity and a unit cost.`,
      };
    }

    const lineTotal = roundMoney(quantity * unitCost);
    additionalCost = roundMoney(additionalCost + lineTotal);
    rows.push({
      component_type: component.componentType,
      description: component.description.trim() || null,
      quantity,
      unit_cost: roundMoney(unitCost),
    });
  }

  return { ok: true as const, rows, additionalCost };
}

function positiveNumber(value: string) {
  if (value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolvedDimension(inherit: boolean, own: string, fallback: string) {
  return positiveNumber(inherit ? fallback : own);
}

function estimateMaterial(
  material: QuoteMaterialComponentDraft,
  line: { quantity: number; defaultWidth: string; defaultHeight: string }
): QuoteMaterialEstimate {
  if (material.costBasis === "manual") {
    if (material.manualMaterialCost.trim() === "") {
      return incompleteMaterial(material.clientKey, "Enter a manual amount, or 0 if there is none");
    }

    const manual = Number(material.manualMaterialCost);

    if (!Number.isFinite(manual) || manual < 0) {
      return incompleteMaterial(material.clientKey, "A manual amount must be zero or more");
    }

    return {
      clientKey: material.clientKey,
      state: "complete",
      areaSqm: null,
      costedAreaSqm: null,
      rate: null,
      materialCost: roundMoney(manual),
      reason: null,
    };
  }

  if (material.sourceKind === "approved_material" && !material.materialId) {
    return incompleteMaterial(material.clientKey, "Choose an approved material");
  }

  if (material.sourceKind === "custom_material" && !material.materialName.trim()) {
    return incompleteMaterial(material.clientKey, "Enter a material name");
  }

  const rate = positiveNumber(material.rate);

  if (rate == null) {
    return incompleteMaterial(
      material.clientKey,
      material.pricingSource === "catalogue"
        ? "Saved catalogue rate is missing"
        : "Enter a cost rate"
    );
  }

  if (material.costBasis === "consumption") {
    const quantity = resolvedDimension(material.inheritQuantity, material.quantity, String(line.quantity));

    if (quantity == null) {
      return incompleteMaterial(material.clientKey, "Enter how many units this material uses");
    }

    return {
      clientKey: material.clientKey,
      state: "complete",
      areaSqm: null,
      costedAreaSqm: null,
      rate: roundRate(rate),
      materialCost: roundMoney(quantity * roundRate(rate)),
      reason: null,
    };
  }

  const width = resolvedDimension(
    material.inheritDimensions,
    material.finishedWidthMm,
    line.defaultWidth
  );
  const height = resolvedDimension(
    material.inheritDimensions,
    material.finishedHeightMm,
    line.defaultHeight
  );
  const quantity = resolvedDimension(material.inheritQuantity, material.quantity, String(line.quantity));

  if (width == null || height == null || quantity == null) {
    return incompleteMaterial(
      material.clientKey,
      "Finished width, height and quantity are required"
    );
  }

  const areaSqm = quoteAreaSqm(width, height, quantity);
  const costedAreaSqm = quoteCostedAreaSqm(areaSqm);

  return {
    clientKey: material.clientKey,
    state: "complete",
    areaSqm,
    costedAreaSqm,
    rate: roundRate(rate),
    materialCost: roundMoney(costedAreaSqm * roundRate(rate)),
    reason: null,
  };
}

function incompleteMaterial(clientKey: string, reason: string): QuoteMaterialEstimate {
  return {
    clientKey,
    state: "incomplete",
    areaSqm: null,
    costedAreaSqm: null,
    rate: null,
    materialCost: null,
    reason,
  };
}

export function estimateQuoteLineCost(input: {
  cost: QuoteLineCostDraft;
  quantity: number;
}): QuoteLineEstimate {
  const parsedComponents = parseComponents(input.cost.components);
  const additionalCost = parsedComponents.ok ? parsedComponents.additionalCost : 0;

  if (!parsedComponents.ok) {
    return {
      state: "incomplete",
      areaSqm: null,
      costedAreaSqm: null,
      ratePerSqm: null,
      materials: [],
      materialCost: null,
      additionalCost: 0,
      totalCost: null,
      reason: parsedComponents.error,
    };
  }

  if (input.cost.materials.length === 0 && input.cost.components.every(componentIsBlank)) {
    return {
      state: "unset",
      areaSqm: null,
      costedAreaSqm: null,
      ratePerSqm: null,
      materials: [],
      materialCost: null,
      additionalCost: 0,
      totalCost: null,
      reason: "No costing saved",
    };
  }

  if (input.cost.materials.length === 0) {
    return {
      state: "incomplete",
      areaSqm: null,
      costedAreaSqm: null,
      ratePerSqm: null,
      materials: [],
      materialCost: null,
      additionalCost,
      totalCost: null,
      reason: "Add a material. An empty material list is not zero.",
    };
  }

  const materials = input.cost.materials.map((material) =>
    estimateMaterial(material, {
      quantity: input.quantity,
      defaultWidth: input.cost.defaultFinishedWidthMm,
      defaultHeight: input.cost.defaultFinishedHeightMm,
    })
  );
  const incomplete = materials.find((material) => material.state !== "complete");
  const onlyArea = materials.length === 1 ? materials[0] : null;

  if (incomplete) {
    return {
      state: "incomplete",
      areaSqm: onlyArea?.areaSqm ?? null,
      costedAreaSqm: onlyArea?.costedAreaSqm ?? null,
      ratePerSqm: onlyArea?.rate ?? null,
      materials,
      materialCost: null,
      additionalCost,
      totalCost: null,
      reason: incomplete.reason,
    };
  }

  const materialCost = roundMoney(
    materials.reduce((sum, material) => sum + (material.materialCost ?? 0), 0)
  );

  return {
    state: "complete",
    areaSqm: onlyArea?.areaSqm ?? null,
    costedAreaSqm: onlyArea?.costedAreaSqm ?? null,
    ratePerSqm: onlyArea?.rate ?? null,
    materials,
    materialCost,
    additionalCost,
    totalCost: roundMoney(materialCost + additionalCost),
    reason: null,
  };
}

export function lineProfit(sellExVat: number, estimate: QuoteLineEstimate) {
  if (estimate.state !== "complete" || estimate.totalCost == null) {
    return {
      profit: null,
      marginPercent: null,
      markupPercent: null,
    };
  }

  const profit = roundMoney(sellExVat - estimate.totalCost);

  return {
    profit,
    marginPercent: sellExVat === 0 ? null : roundMoney((profit / sellExVat) * 100),
    markupPercent:
      estimate.totalCost === 0 ? null : roundMoney((profit / estimate.totalCost) * 100),
  };
}

export function quoteProfitFigures(
  lines: Array<{
    isOptional: boolean;
    sellExVat: number;
    estimate: QuoteLineEstimate;
  }>
): QuoteProfitFigures {
  const included = lines.filter((line) => !line.isOptional);
  const sellExVat = roundMoney(included.reduce((sum, line) => sum + line.sellExVat, 0));
  const provisional = included.some((line) => line.estimate.state !== "complete");

  if (provisional) {
    return {
      sellExVat,
      materialCost: null,
      additionalCost: null,
      totalCost: null,
      profit: null,
      marginPercent: null,
      markupPercent: null,
      provisional: true,
    };
  }

  const materialCost = roundMoney(
    included.reduce((sum, line) => sum + (line.estimate.materialCost ?? 0), 0)
  );
  const additionalCost = roundMoney(
    included.reduce((sum, line) => sum + line.estimate.additionalCost, 0)
  );
  const totalCost = roundMoney(materialCost + additionalCost);
  const profit = roundMoney(sellExVat - totalCost);

  return {
    sellExVat,
    materialCost,
    additionalCost,
    totalCost,
    profit,
    marginPercent: sellExVat === 0 ? null : roundMoney((profit / sellExVat) * 100),
    markupPercent: totalCost === 0 ? null : roundMoney((profit / totalCost) * 100),
    provisional: false,
  };
}

function optionalNumber(value: string) {
  const parsed = positiveNumber(value);
  return parsed == null ? undefined : parsed;
}

export function buildReplaceDraftLinesPayload(lines: DraftQuoteLineInput[]) {
  const payload = [];

  for (const [index, line] of lines.entries()) {
    const parsedComponents = parseComponents(line.cost.components);

    if (!parsedComponents.ok) {
      return {
        ok: false as const,
        error: `Item ${index + 1}: ${parsedComponents.error}`,
      };
    }

    const base = {
      ...(line.id ? { id: line.id } : {}),
      title: line.title.trim(),
      description: line.description.trim() || null,
      quantity: line.quantity,
      unit_price: roundMoney(line.unitPrice),
      is_optional: line.isOptional,
      image_storage_path: line.imageStoragePath,
      image_file_name: line.imageFileName,
      image_file_type: line.imageFileType,
      image_file_size: line.imageFileSize,
    };

    if (
      line.cost.cleared === true &&
      line.cost.materials.length === 0 &&
      parsedComponents.rows.length === 0
    ) {
      payload.push({ ...base, cost: { clear: true } });
      continue;
    }

    if (
      line.cost.materials.length === 0 &&
      parsedComponents.rows.length === 0
    ) {
      payload.push({ ...base, cost: null });
      continue;
    }

    payload.push({
      ...base,
      cost: {
        default_finished_width_mm: optionalNumber(line.cost.defaultFinishedWidthMm) ?? null,
        default_finished_height_mm: optionalNumber(line.cost.defaultFinishedHeightMm) ?? null,
        materials: line.cost.materials.map((material) => {
          const width = resolvedDimension(
            material.inheritDimensions,
            material.finishedWidthMm,
            line.cost.defaultFinishedWidthMm
          );
          const height = resolvedDimension(
            material.inheritDimensions,
            material.finishedHeightMm,
            line.cost.defaultFinishedHeightMm
          );
          const quantity = resolvedDimension(
            material.inheritQuantity,
            material.quantity,
            String(line.quantity)
          );
          const manual =
            material.manualMaterialCost.trim() === ""
              ? null
              : roundMoney(Number(material.manualMaterialCost));

          return {
            ...(material.savedId ? { id: material.savedId } : { intent: "add" }),
            source_kind: material.sourceKind,
            cost_basis: material.costBasis,
            use_current_rate: material.refreshRate,
            material_id: material.sourceKind === "approved_material" ? material.materialId : null,
            material_supplier_product_id:
              material.sourceKind === "approved_material" ? material.productId : null,
            material_price_id:
              material.sourceKind === "approved_material" ? material.priceId : null,
            material_name:
              material.materialName.trim() ||
              (material.costBasis === "manual" ? "Manual amount" : null),
            supplier_name: material.supplierName.trim() || null,
            purchase_unit: material.purchaseUnit || null,
            snapshotted_rate:
              material.sourceKind === "custom_material" &&
              material.costBasis !== "manual" &&
              material.rate.trim() !== ""
                ? roundRate(Number(material.rate))
                : null,
            inherit_dimensions: material.inheritDimensions,
            inherit_quantity: material.inheritQuantity,
            ...(width == null ? {} : { finished_width_mm: width }),
            ...(height == null ? {} : { finished_height_mm: height }),
            ...(quantity == null ? {} : { quantity }),
            manual_material_cost: material.costBasis === "manual" ? manual : null,
            confirm_manual_amount:
              material.costBasis === "manual" && material.confirmManualAmount,
          };
        }),
        components: parsedComponents.rows,
      },
    });
  }

  return { ok: true as const, lines: payload };
}

export function formatRatePerSquareMetre(value: number) {
  const [whole, fraction = ""] = value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "").split(".");
  const digits = (fraction + "00").slice(0, Math.max(2, fraction.length));
  return `£${whole}.${digits}/m²`;
}

export function formatUnitRate(value: number, unitLabel: string) {
  const [whole, fraction = ""] = value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "").split(".");
  const digits = (fraction + "00").slice(0, Math.max(2, fraction.length));
  return `£${whole}.${digits}/${unitLabel}`;
}

export function formatSquareMetres(value: number) {
  const text = value
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1");
  return `${text} m²`;
}

export function formatPercent(value: number | null) {
  if (value == null) {
    return "—";
  }

  return `${value.toFixed(1)}%`;
}
