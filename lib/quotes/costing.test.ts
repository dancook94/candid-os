import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { quoteDateInputValue } from "@/lib/app-settings";

import {
  approvedRatePerSquareMetre,
  buildReplaceDraftLinesPayload,
  canEditQuoteVersion,
  clearQuoteLineCost,
  costDraftFromSnapshot,
  detachQuoteLineCostIdentity,
  emptyMaterialComponent,
  emptyQuoteLineCost,
  estimateQuoteLineCost,
  quoteAreaSqm,
  quoteCostedAreaSqm,
  quoteProfitFigures,
  type QuoteLineCostDraft,
  type QuoteMaterialComponentDraft,
} from "@/lib/quotes/costing";

function board(): QuoteMaterialComponentDraft {
  return emptyMaterialComponent({
    savedId: "component-1",
    sourceKind: "approved_material",
    costBasis: "area",
    pricingSource: "catalogue",
    materialId: "material-1",
    productId: "product-1",
    priceId: "price-old",
    materialName: "Board",
    supplierName: "Pyramid",
    purchaseUnit: "square_metre",
    rate: "8.77",
    rateSource: "saved",
    inheritDimensions: false,
    inheritQuantity: false,
    finishedWidthMm: "1000",
    finishedHeightMm: "2000",
    quantity: "5",
  });
}

function lineCost(materials: QuoteMaterialComponentDraft[]): QuoteLineCostDraft {
  return {
    ...emptyQuoteLineCost(),
    materials,
  };
}

function line(overrides: Partial<Parameters<typeof buildReplaceDraftLinesPayload>[0][number]> = {}) {
  return {
    title: "Panels",
    description: "",
    quantity: 5,
    unitPrice: 40,
    isOptional: false,
    imageStoragePath: null,
    imageFileName: null,
    imageFileType: null,
    imageFileSize: null,
    cost: lineCost([board()]),
    ...overrides,
  };
}

test("square-metre costing uses a fixed 10 percent wastage", () => {
  assert.equal(quoteAreaSqm(1000, 2000, 5), 10);
  assert.equal(quoteCostedAreaSqm(10), 11);

  const estimate = estimateQuoteLineCost({ cost: lineCost([board()]), quantity: 5 });
  assert.equal(estimate.state, "complete");
  assert.equal(estimate.areaSqm, 10);
  assert.equal(estimate.costedAreaSqm, 11);
  assert.equal(estimate.ratePerSqm, 8.77);
  assert.equal(estimate.materialCost, 96.47);
});

test("approved rate conversion rounds to four decimal places", () => {
  assert.equal(
    approvedRatePerSquareMetre({
      price: 8.77,
      priceUnit: "square_metre",
      widthMm: null,
      heightMm: null,
      lengthMm: null,
    }),
    8.77
  );
  assert.equal(
    approvedRatePerSquareMetre({
      price: 12,
      priceUnit: "unit",
      widthMm: null,
      heightMm: null,
      lengthMm: null,
    }),
    null
  );
});

test("missing dimensions or a missing price stay incomplete", () => {
  const missingSize = estimateQuoteLineCost({
    cost: lineCost([{ ...board(), finishedWidthMm: "" }]),
    quantity: 5,
  });
  assert.equal(missingSize.state, "incomplete");
  assert.equal(missingSize.materialCost, null);

  const missingPrice = estimateQuoteLineCost({
    cost: lineCost([{ ...board(), rate: "" }]),
    quantity: 5,
  });
  assert.equal(missingPrice.state, "incomplete");
  assert.equal(missingPrice.materialCost, null);
  assert.notEqual(missingPrice.materialCost, 0);
});

test("several materials on one line stay independent", () => {
  const vinyl = emptyMaterialComponent({
    sourceKind: "approved_material",
    costBasis: "area",
    pricingSource: "catalogue",
    materialId: "vinyl",
    materialName: "Vinyl",
    rate: "5",
    rateSource: "saved",
    inheritDimensions: true,
    inheritQuantity: true,
  });
  const ink = emptyMaterialComponent({
    sourceKind: "approved_material",
    costBasis: "consumption",
    pricingSource: "catalogue",
    materialId: "ink",
    materialName: "Ink",
    purchaseUnit: "unit",
    rate: "12.5",
    rateSource: "saved",
    inheritQuantity: false,
    quantity: "2",
  });
  const packaging = emptyMaterialComponent({
    sourceKind: "custom_material",
    costBasis: "manual",
    pricingSource: "manual",
    materialName: "Packaging",
    manualMaterialCost: "0",
  });
  const estimate = estimateQuoteLineCost({
    cost: {
      ...emptyQuoteLineCost(),
      defaultFinishedWidthMm: "1000",
      defaultFinishedHeightMm: "1000",
      materials: [vinyl, ink, packaging],
    },
    quantity: 10,
  });

  assert.equal(estimate.state, "complete");
  assert.equal(estimate.materials[0].materialCost, 55);
  assert.equal(estimate.materials[1].materialCost, 25);
  assert.equal(estimate.materials[1].areaSqm, null);
  assert.equal(estimate.materials[2].materialCost, 0);
  assert.equal(estimate.materials[2].rate, null);
  assert.equal(estimate.materialCost, 80);
});

test("one incomplete material hides the line cost", () => {
  const estimate = estimateQuoteLineCost({
    cost: lineCost([
      board(),
      emptyMaterialComponent({
        sourceKind: "approved_material",
        costBasis: "area",
        pricingSource: "catalogue",
        materialId: "ink",
        materialName: "Ink",
        rate: "",
      }),
    ]),
    quantity: 5,
  });

  assert.equal(estimate.state, "incomplete");
  assert.equal(estimate.materialCost, null);
  assert.equal(estimate.totalCost, null);
  assert.equal(estimate.materials[0].materialCost, 96.47);
});

test("a custom material uses the entered rate and does not send a catalog id", () => {
  const payload = buildReplaceDraftLinesPayload([
    line({
      cost: lineCost([
        emptyMaterialComponent({
          sourceKind: "custom_material",
          costBasis: "area",
          pricingSource: "custom",
          materialName: "Client board",
          rate: "8.77",
          rateSource: "custom",
          inheritDimensions: false,
          inheritQuantity: false,
          finishedWidthMm: "1000",
          finishedHeightMm: "2000",
          quantity: "5",
        }),
      ]),
    }),
  ]);

  assert.equal(payload.ok, true);
  if (!payload.ok) {
    return;
  }

  const materials = payload.lines[0].cost?.materials as Array<{
    intent: string;
    material_id: string | null;
    material_price_id: string | null;
    snapshotted_rate: number;
    use_current_rate: boolean;
  }>;
  assert.equal(materials[0].intent, "add");
  assert.equal(materials[0].material_id, null);
  assert.equal(materials[0].material_price_id, null);
  assert.equal(materials[0].snapshotted_rate, 8.77);
  assert.equal(materials[0].use_current_rate, false);
});

test("a zero manual amount is complete and a blank manual amount is incomplete", () => {
  const zero = estimateQuoteLineCost({
    cost: lineCost([
      emptyMaterialComponent({
        pricingSource: "manual",
        costBasis: "manual",
        materialName: "Service",
        manualMaterialCost: "0",
      }),
    ]),
    quantity: 1,
  });
  assert.equal(zero.state, "complete");
  assert.equal(zero.materialCost, 0);
  assert.equal(zero.totalCost, 0);

  const blank = estimateQuoteLineCost({
    cost: lineCost([
      emptyMaterialComponent({
        pricingSource: "manual",
        costBasis: "manual",
        materialName: "Service",
        manualMaterialCost: "",
      }),
    ]),
    quantity: 1,
  });
  assert.equal(blank.state, "incomplete");
  assert.equal(blank.materialCost, null);
});

test("labour and another component add to the material cost", () => {
  const estimate = estimateQuoteLineCost({
    cost: {
      ...lineCost([board()]),
      components: [
        {
          clientKey: "labour",
          componentType: "labour",
          description: "Make up",
          quantity: "1.5",
          unitCost: "40",
        },
        {
          clientKey: "print",
          componentType: "printing",
          description: "Print",
          quantity: "5",
          unitCost: "2",
        },
      ],
    },
    quantity: 5,
  });

  assert.equal(estimate.additionalCost, 70);
  assert.equal(estimate.totalCost, 166.47);
});

test("optional lines are excluded and an incomplete line makes profitability provisional", () => {
  const complete = estimateQuoteLineCost({ cost: lineCost([board()]), quantity: 5 });
  const figures = quoteProfitFigures([
    { isOptional: false, sellExVat: 200, estimate: complete },
    {
      isOptional: true,
      sellExVat: 50,
      estimate: estimateQuoteLineCost({
        cost: lineCost([
          emptyMaterialComponent({
            costBasis: "manual",
            pricingSource: "manual",
            manualMaterialCost: "0",
          }),
        ]),
        quantity: 1,
      }),
    },
    {
      isOptional: false,
      sellExVat: 10,
      estimate: estimateQuoteLineCost({ cost: emptyQuoteLineCost(), quantity: 1 }),
    },
  ]);

  assert.equal(figures.sellExVat, 210);
  assert.equal(figures.provisional, true);
  assert.equal(figures.totalCost, null);
  assert.equal(figures.profit, null);
});

test("a saved catalogue rate is sent without a refresh request", () => {
  const restored = costDraftFromSnapshot({
    summary: {
      id: "cost-1",
      cost_kind: "approved_material",
      cost_basis: "area",
      material_id: "material-1",
      material_supplier_product_id: "product-1",
      material_price_id: "price-old",
      material_name: "Board",
      supplier_name: "Pyramid",
      rate_per_sqm: "8.77",
      finished_width_mm: "1000",
      finished_height_mm: "2000",
      quantity: "5",
      manual_material_cost: null,
    },
    components: [],
  });
  assert.equal(restored.materials[0].rateSource, "saved");
  assert.equal(restored.materials[0].priceId, "price-old");
  assert.equal(restored.materials[0].rate, "8.77");
  assert.equal(restored.materials[0].refreshRate, false);
  assert.equal(restored.materials[0].savedId, "cost-1");
  assert.equal(restored.materials[0].pricingSource, "catalogue");

  const payload = buildReplaceDraftLinesPayload([line({ cost: restored })]);
  assert.equal(payload.ok, true);
  if (!payload.ok) {
    return;
  }

  const material = payload.lines[0].cost?.materials?.[0] as {
    id: string;
    material_price_id: string;
    snapshotted_rate: number | null;
    use_current_rate: boolean;
    intent?: string;
  };
  assert.equal(material.id, "cost-1");
  assert.equal(material.material_price_id, "price-old");
  assert.equal(material.snapshotted_rate, null);
  assert.equal(material.use_current_rate, false);
  assert.equal("intent" in material, false);
});

test("an explicit refresh is the only catalogue reprice flag", () => {
  const saved = board();
  const payload = buildReplaceDraftLinesPayload([
    line({
      cost: lineCost([{ ...saved, refreshRate: true, priceId: "price-current", rate: "9.10" }]),
    }),
  ]);
  assert.equal(payload.ok, true);
  if (!payload.ok) {
    return;
  }

  const material = payload.lines[0].cost?.materials?.[0] as {
    id: string;
    material_price_id: string;
    use_current_rate: boolean;
  };
  assert.equal(material.id, "component-1");
  assert.equal(material.material_price_id, "price-current");
  assert.equal(material.use_current_rate, true);
});

test("a manual amount stays distinct from a catalogue rate", () => {
  const restored = costDraftFromSnapshot({
    summary: {
      id: "cost-manual",
      cost_kind: "composite",
      material_id: null,
      material_supplier_product_id: null,
      material_price_id: null,
      material_name: null,
      supplier_name: null,
      rate_per_sqm: null,
      finished_width_mm: null,
      finished_height_mm: null,
      manual_material_cost: null,
    },
    materials: [
      {
        id: "manual-1",
        sort_order: 1,
        source_kind: "approved_material",
        cost_basis: "manual",
        pricing_source: "manual",
        material_id: "ink",
        material_supplier_product_id: "ink-product",
        material_price_id: "ink-price",
        material_name: "Ink",
        supplier_name: "Pyramid",
        purchase_unit: null,
        snapshotted_rate: null,
        finished_width_mm: null,
        finished_height_mm: null,
        quantity: null,
        inherit_dimensions: false,
        inherit_quantity: false,
        manual_material_cost: "18",
      },
    ],
    components: [],
  });
  assert.equal(restored.materials[0].pricingSource, "manual");
  assert.equal(restored.materials[0].rate, "");
  assert.equal(restored.materials[0].manualMaterialCost, "18");

  const payload = buildReplaceDraftLinesPayload([
    line({
      cost: {
        ...restored,
        materials: [{ ...restored.materials[0], manualMaterialCost: "21", confirmManualAmount: true }],
      },
    }),
  ]);
  assert.equal(payload.ok, true);
  if (!payload.ok) {
    return;
  }

  const material = payload.lines[0].cost?.materials?.[0] as {
    cost_basis: string;
    snapshotted_rate: number | null;
    manual_material_cost: number;
    confirm_manual_amount: boolean;
    material_price_id: string;
  };
  assert.equal(material.cost_basis, "manual");
  assert.equal(material.snapshotted_rate, null);
  assert.equal(material.manual_material_cost, 21);
  assert.equal(material.confirm_manual_amount, true);
  assert.equal(material.material_price_id, "ink-price");
  assert.equal(material.material_name, "Ink");
});

test("a renamed manual amount keeps its label and does not confirm a new amount", () => {
  const restored = costDraftFromSnapshot({
    summary: {
      id: "cost-manual",
      cost_kind: "composite",
      material_id: null,
      material_supplier_product_id: null,
      material_price_id: null,
      material_name: null,
      supplier_name: null,
      rate_per_sqm: null,
      finished_width_mm: null,
      finished_height_mm: null,
      manual_material_cost: null,
    },
    materials: [
      {
        id: "manual-1",
        sort_order: 1,
        source_kind: "custom_material",
        cost_basis: "manual",
        pricing_source: "manual",
        material_id: null,
        material_supplier_product_id: null,
        material_price_id: null,
        material_name: "Manual amount",
        supplier_name: null,
        purchase_unit: null,
        snapshotted_rate: null,
        finished_width_mm: null,
        finished_height_mm: null,
        quantity: null,
        inherit_dimensions: false,
        inherit_quantity: false,
        manual_material_cost: "10",
      },
    ],
    components: [],
  });

  const payload = buildReplaceDraftLinesPayload([
    line({
      cost: {
        ...restored,
        materials: [{ ...restored.materials[0], materialName: "Packaging" }],
      },
    }),
  ]);
  assert.equal(payload.ok, true);
  if (!payload.ok) {
    return;
  }

  const material = payload.lines[0].cost?.materials?.[0] as {
    material_name: string;
    manual_material_cost: number;
    confirm_manual_amount: boolean;
  };
  assert.equal(material.material_name, "Packaging");
  assert.equal(material.manual_material_cost, 10);
  assert.equal(material.confirm_manual_amount, false);
});

test("a blank manual name falls back to the stored label", () => {
  const payload = buildReplaceDraftLinesPayload([
    line({
      cost: {
        ...emptyQuoteLineCost(),
        materials: [
          emptyMaterialComponent({
            sourceKind: "custom_material",
            costBasis: "manual",
            pricingSource: "manual",
            materialName: "   ",
            manualMaterialCost: "10",
            inheritDimensions: false,
            inheritQuantity: false,
          }),
        ],
      },
    }),
  ]);
  assert.equal(payload.ok, true);
  if (!payload.ok) {
    return;
  }

  const material = payload.lines[0].cost?.materials?.[0] as { material_name: string };
  assert.equal(material.material_name, "Manual amount");
});

test("a line with no costing choice does not invent a zero cost", () => {
  const payload = buildReplaceDraftLinesPayload([
    line({ id: "line-1", cost: emptyQuoteLineCost() }),
  ]);
  assert.equal(payload.ok, true);
  if (!payload.ok) {
    return;
  }

  assert.equal(payload.lines[0].id, "line-1");
  assert.equal(payload.lines[0].cost, null);
});

test("reordering materials keeps each snapshot id with that material", () => {
  const vinyl = board();
  const laminate = emptyMaterialComponent({
    ...board(),
    savedId: "component-2",
    materialName: "Laminate",
    supplierName: "Sign Trade",
    priceId: "price-laminate",
  });
  const forward = buildReplaceDraftLinesPayload([
    line({ id: "line-1", cost: lineCost([vinyl, laminate]) }),
  ]);
  const reversed = buildReplaceDraftLinesPayload([
    line({ id: "line-1", cost: lineCost([laminate, vinyl]) }),
  ]);
  assert.equal(forward.ok && reversed.ok, true);
  if (!forward.ok || !reversed.ok) {
    return;
  }

  const forwardIds = (forward.lines[0].cost?.materials ?? []).map(
    (material) => material.id
  );
  const reversedIds = (reversed.lines[0].cost?.materials ?? []).map(
    (material) => material.id
  );
  assert.deepEqual(forwardIds, ["component-1", "component-2"]);
  assert.deepEqual(reversedIds, ["component-2", "component-1"]);
  assert.equal(reversed.lines[0].cost?.materials?.[0].supplier_name, "Sign Trade");
  assert.equal(reversed.lines[0].cost?.materials?.[1].material_price_id, "price-old");
});

test("an omitted cost payload is distinct from intentional removal", () => {
  const omitted = buildReplaceDraftLinesPayload([
    line({ id: "line-1", cost: emptyQuoteLineCost() }),
  ]);
  const removed = buildReplaceDraftLinesPayload([
    line({ id: "line-1", cost: clearQuoteLineCost() }),
  ]);
  assert.equal(omitted.ok && removed.ok, true);
  if (!omitted.ok || !removed.ok) {
    return;
  }

  assert.equal(omitted.lines[0].cost, null);
  assert.deepEqual(removed.lines[0].cost, { clear: true });
});

test("a duplicated line does not claim the source snapshot ids", () => {
  const detached = detachQuoteLineCostIdentity(lineCost([board()]));
  assert.equal(detached.materials[0].savedId, null);
  assert.equal(detached.materials[0].refreshRate, true);
  const payload = buildReplaceDraftLinesPayload([line({ cost: detached })]);
  assert.equal(payload.ok, true);
  if (!payload.ok) {
    return;
  }

  const material = payload.lines[0].cost?.materials?.[0];
  assert.equal(material?.id, undefined);
  assert.equal(material?.intent, "add");
  assert.equal(payload.lines[0].id, undefined);
});

test("snapshot identity is the component id and omitted costs are preserved", () => {
  const sql = readFileSync(
    "docs/proposed-quote-item-material-components-migration.sql",
    "utf8"
  );
  const code = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  assert.equal(code.includes("element ->> 'component_sort'"), false);
  assert.equal(code.includes("element ->> 'line_sort'"), false);
  assert.match(code, /Material snapshot does not belong to this quote version/);
  assert.match(code, /Material snapshot was already used on this save/);
  assert.match(code, /Material component id is required/);
  assert.match(code, /Quote line was already used on this save/);
  assert.match(code, /v_cost ->> 'clear'/);
  assert.match(code, /jsonb_populate_record\(\s*NULL::public\.quote_item_costs/);
});

test("published versions cannot be edited", () => {
  assert.equal(canEditQuoteVersion("draft"), true);
  for (const status of ["sent", "accepted", "declined", "superseded"]) {
    assert.equal(canEditQuoteVersion(status), false);
  }
});

test("customer, invoice, and send paths do not read quote costs", () => {
  const files = [
    "lib/customer-formal-quote-data.ts",
    "lib/generate-customer-quote-pdf.ts",
    "lib/quotes/send-quote.ts",
    "lib/invoice/service.ts",
    "lib/invoice/quote-lines.ts",
  ];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("quote_item_costs"), false, file);
    assert.equal(source.includes("quote_item_cost_components"), false, file);
    assert.equal(source.includes("quote_item_material_components"), false, file);
  }
});

test("quote costing does not use the service role or Gmail", () => {
  const files = [
    "lib/quotes/costing.ts",
    "lib/quotes/material-catalog.ts",
    "lib/quotes/load-quote-costs.ts",
    "components/quote-line-costing-panel.tsx",
    "components/create-quote-version-button.tsx",
    "components/quote-builder-form.tsx",
  ];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("createAdminClient"), false, file);
    assert.equal(source.toLowerCase().includes("gmail"), false, file);
  }
});

test("draft edits save through the atomic function", () => {
  const source = readFileSync("components/quote-builder-form.tsx", "utf8");
  assert.equal(source.includes("replace_draft_quote_lines"), true);
  assert.equal(source.includes('.from("quote_items")\n        .delete()'), false);
  const versionCopy = readFileSync("components/create-quote-version-button.tsx", "utf8");
  assert.equal(versionCopy.includes("duplicate_quote_version"), true);
  assert.equal(versionCopy.includes('.from("quote_items")'), false);
});

test("expiry dates shown in the editor use the calendar date", () => {
  assert.equal(quoteDateInputValue("2026-11-12T00:00:00.000Z"), "2026-11-12");
  assert.equal(quoteDateInputValue("2026-11-12"), "2026-11-12");
  assert.equal(quoteDateInputValue(""), "");
  assert.equal(quoteDateInputValue(null), "");
});

test("multi-material migration does not change customer quote access", () => {
  const sql = readFileSync(
    "docs/proposed-quote-item-material-components-migration.sql",
    "utf8"
  );
  const code = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  assert.equal(/drop policy[\s\S]{0,120}on public\.quotes\b/i.test(code), false);
  assert.equal(/create policy[\s\S]{0,120}on public\.quotes\b/i.test(code), false);
  assert.equal(/on public\.quote_versions\b/i.test(code), false);
  assert.equal(/grant [^;]+ on (table )?public\.quotes\b/i.test(code), false);
  assert.equal(/grant [^;]+ on (table )?public\.quote_items\b/i.test(code), false);

  const customerPage = readFileSync("app/quotes/[id]/page.tsx", "utf8");
  const response = readFileSync("lib/customer-quote-response.ts", "utf8");
  assert.match(response, /quote\.company_id !== profile\.company_id/);
  assert.match(customerPage, /fetchCustomerFormalQuote/);
  assert.equal(customerPage.includes("quote_item_material_components"), false);
});
