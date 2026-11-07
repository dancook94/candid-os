import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  buildBulkReview,
  cleanInvoiceProductName,
  existingLinkReviewStatus,
  planBulkDecision,
  type BulkCatalogueMaterial,
  type BulkDecision,
  type BulkReviewSourceInvoice,
  type BulkReviewSourceLine,
} from "@/lib/materials/invoices/bulk-review";
import type { InvoiceMatchProduct } from "@/lib/materials/invoices/model";

function invoice(
  overrides: Partial<BulkReviewSourceInvoice> & Pick<BulkReviewSourceInvoice, "id">
): BulkReviewSourceInvoice {
  return {
    number: overrides.number ?? overrides.id,
    date: overrides.date ?? "2024-05-01",
    supplierId: overrides.supplierId === undefined ? "supplier" : overrides.supplierId,
    supplierName: overrides.supplierName === undefined ? "Supplier" : overrides.supplierName,
    extractionStatus: "extracted",
    extractionWarnings: [],
    processingStatus: "unmatched",
    subtotal: null,
    vat: null,
    total: null,
    ...overrides,
  };
}

function line(
  overrides: Partial<BulkReviewSourceLine> & Pick<BulkReviewSourceLine, "id" | "invoiceId">
): BulkReviewSourceLine {
  return {
    description: "Product",
    sku: null,
    quantity: 1,
    statedUnit: "roll",
    reviewedUnit: null,
    unitPrice: 10,
    lineTotal: 10,
    reviewStatus: "unmatched",
    mathsWarning: null,
    matchedProductId: null,
    matchConfidence: null,
    historicalPriceRetained: false,
    bulkPriceApproved: false,
    roundingAccepted: false,
    ...overrides,
  };
}

function product(
  overrides: Partial<InvoiceMatchProduct> & Pick<InvoiceMatchProduct, "id" | "supplierId">
): InvoiceMatchProduct {
  return {
    sku: null,
    description: "Product description",
    materialName: "Material",
    purchaseUnit: "roll",
    thicknessMm: null,
    colour: null,
    widthMm: null,
    heightMm: null,
    lengthMm: null,
    currentPrice: 100,
    currentPriceUnit: "roll",
    currentPriceId: "price-1",
    currentEffectiveDate: "2026-01-01",
    ...overrides,
  };
}

function material(
  overrides: Partial<BulkCatalogueMaterial> & Pick<BulkCatalogueMaterial, "id" | "name" | "purchaseUnit">
): BulkCatalogueMaterial {
  return {
    thicknessMm: null,
    colour: null,
    finish: null,
    widthMm: null,
    heightMm: null,
    lengthMm: null,
    ...overrides,
  };
}

function review(input: {
  invoices: BulkReviewSourceInvoice[];
  lines: BulkReviewSourceLine[];
  products?: InvoiceMatchProduct[];
  materials?: BulkCatalogueMaterial[];
}) {
  return buildBulkReview({
    invoices: input.invoices,
    lines: input.lines,
    products: input.products ?? [],
    materials: input.materials ?? [],
  });
}

function decide(
  built: ReturnType<typeof review>,
  decision: BulkDecision,
  selected: BulkReviewSourceLine[] = built.groups.flatMap((group) =>
    group.lines.map((view) => {
      throw new Error(`Pass selected rows for ${view.id}`);
    })
  ),
  materials: BulkCatalogueMaterial[] = []
) {
  return planBulkDecision(built.groups, selected, materials, decision);
}

describe("bulk invoice review grouping", () => {
  it("groups repeated All Print prices without approving them", () => {
    const m16 = product({
      id: "m16-p",
      supplierId: "all-print",
      sku: "M16-P-P",
      description: "Nucoat M16 Permanent White 1370mm x 50m",
      materialName: "Nucoat M16 Permanent White 1370mm x 50m",
      currentPrice: 140,
    });
    const highTack = product({
      id: "m16-h",
      supplierId: "all-print",
      sku: "M16-H-P",
      materialName: "Nucoat M16 High Tack White 1370mm x 50m",
      currentPrice: 270,
    });
    const invoices = [1, 2, 3, 4].map((number) =>
      invoice({ id: `m16-${number}`, supplierId: "all-print", supplierName: "All Print Supplies", date: `2024-0${number}-01` })
    );
    const lines = invoices.flatMap((item, index) => [
      line({
        id: `perm-${index}`,
        invoiceId: item.id,
        description: m16.description,
        sku: "M16-P-P",
        unitPrice: 126.07,
        lineTotal: 126.07,
        reviewStatus: "price_change",
        matchedProductId: m16.id,
        matchConfidence: "high",
      }),
      line({
        id: `tack-${index}`,
        invoiceId: item.id,
        description: "Nucoat M16 High Tack",
        sku: "M16-H-P",
        unitPrice: 258.43,
        lineTotal: 258.43,
        reviewStatus: "price_change",
        matchedProductId: highTack.id,
        matchConfidence: "high",
      }),
    ]);
    const built = review({ invoices, lines, products: [m16, highTack] });
    const groups = built.groups.filter((group) => group.kind === "historical_price");

    assert.equal(groups.length, 2);
    assert.equal(groups.find((group) => group.productId === m16.id)?.lineCount, 4);
    assert.equal(groups.find((group) => group.productId === m16.id)?.invoicePrice, 126.07);
    assert.equal(groups.find((group) => group.productId === m16.id)?.cataloguePrice, 140);
    assert.match(groups[0].proposedAction, /not approved on its own/);
    assert.match(groups[0].warnings.join(" "), /does not approve it/);
  });

  it("keeps Pyramid Dibond historical prices apart", () => {
    const dibond = product({
      id: "dibond",
      supplierId: "pyramid",
      sku: "ALUED32422",
      materialName: "Dibond",
      purchaseUnit: "sheet",
      currentPriceUnit: "sheet",
      currentPrice: 42,
    });
    const invoices = ["25a", "25b", "38"].map((id) =>
      invoice({ id, supplierId: "pyramid", supplierName: "Pyramid", date: "2024-03-01" })
    );
    const lines = [
      line({
        id: "d1",
        invoiceId: "25a",
        sku: "ALUED32422",
        statedUnit: "sheet",
        unitPrice: 25.34,
        lineTotal: 25.34,
        reviewStatus: "price_change",
        matchedProductId: dibond.id,
        matchConfidence: "high",
      }),
      line({
        id: "d2",
        invoiceId: "25b",
        sku: "ALUED32422",
        statedUnit: "sheet",
        unitPrice: 25.34,
        lineTotal: 25.34,
        reviewStatus: "price_change",
        matchedProductId: dibond.id,
        matchConfidence: "high",
      }),
      line({
        id: "d3",
        invoiceId: "38",
        sku: "ALUED32422",
        statedUnit: "sheet",
        unitPrice: 38.79,
        lineTotal: 38.79,
        reviewStatus: "price_change",
        matchedProductId: dibond.id,
        matchConfidence: "high",
      }),
    ];
    const groups = review({ invoices, lines, products: [dibond] }).groups;

    assert.equal(groups.filter((group) => group.invoicePrice === 25.34)[0]?.lineCount, 2);
    assert.equal(groups.filter((group) => group.invoicePrice === 38.79)[0]?.lineCount, 1);
  });

  it("groups freight and courier charges without treating material lines as charges", () => {
    const invoices = [
      invoice({ id: "pg", supplierId: "papergraphics", supplierName: "Papergraphics" }),
      invoice({ id: "aps", supplierId: "all-print", supplierName: "All Print Supplies" }),
    ];
    const lines = [
      line({ id: "f1", invoiceId: "pg", description: "Freight", statedUnit: null, unitPrice: 21.81, lineTotal: 21.81 }),
      line({ id: "f2", invoiceId: "pg", description: "Freight", statedUnit: null, unitPrice: 5.19, lineTotal: 5.19 }),
      line({ id: "f3", invoiceId: "pg", description: "Freight", statedUnit: null, unitPrice: 108, lineTotal: 108 }),
      line({
        id: "c1",
        invoiceId: "aps",
        description: "**SAME DAY COURIERS**",
        statedUnit: null,
        unitPrice: 85,
        lineTotal: 85,
      }),
      line({
        id: "fabric",
        invoiceId: "aps",
        description: "BLACKBACK FABRIC 2.5m x 91m SAME DAY COURIER",
        statedUnit: "roll",
        unitPrice: 187.2,
        lineTotal: 187.2,
      }),
      line({
        id: "vinyl",
        invoiceId: "aps",
        description: "MPI1104EA WHITE GLOSS CAST 1370MM 1 SAME DAY COURIERS",
        statedUnit: "roll",
        unitPrice: 4.05,
        lineTotal: 4.05,
      }),
    ];
    const built = review({ invoices, lines });
    const freight = built.groups.find((group) => group.kind === "charge" && group.supplierId === "papergraphics");

    assert.equal(freight?.lineCount, 3);
    assert.equal(built.groups.find((group) => group.lines.some((item) => item.id === "c1"))?.kind, "charge");
    assert.notEqual(built.groups.find((group) => group.lines.some((item) => item.id === "fabric"))?.kind, "charge");
    assert.notEqual(built.groups.find((group) => group.lines.some((item) => item.id === "vinyl"))?.kind, "charge");
  });

  it("points Antalis wording differences at one existing product and does not choose between sizes", () => {
    const kraft = product({
      id: "kraft",
      supplierId: "antalis",
      description: "Ribbed Kraft Paper, Master'in Access 90 g/m2, 600 mm x 220.00 m",
      materialName: "Kraft Brown Wrapping Paper 600mm 90gsm",
      widthMm: 600,
      lengthMm: 220000,
    });
    const emblem = product({
      id: "emblem",
      supplierId: "antalis",
      description: "Emblem Grey 450 µm 640mm x 450mm",
      materialName: "Emblem Grey",
      purchaseUnit: "sheet",
      currentPriceUnit: "sheet",
      widthMm: 640,
      heightMm: 450,
    });
    const wide = product({
      id: "foam-wide",
      supplierId: "antalis",
      description: "Foamalite XPRESS white 5.000mm 1220mm x 2440mm",
      materialName: "Foamalite 2440 x 1220",
      purchaseUnit: "sheet",
      currentPriceUnit: "sheet",
      widthMm: 1220,
      heightMm: 2440,
    });
    const narrow = product({
      id: "foam-narrow",
      supplierId: "antalis",
      description: "Foamalite XPRESS white 5.000mm 1560mm x 3050mm",
      materialName: "Foamalite 3050 x 1560",
      purchaseUnit: "sheet",
      currentPriceUnit: "sheet",
      widthMm: 1560,
      heightMm: 3050,
    });
    const built = review({
      invoices: [invoice({ id: "ant", supplierId: "antalis", supplierName: "Antalis" })],
      lines: [
        line({
          id: "kraft-line",
          invoiceId: "ant",
          description: "Ribbed Kraft Paper, Master'in Access 90 g/m2, 600 mm x 220.00 m, buff core",
          statedUnit: "roll",
          sku: "618598",
        }),
        line({
          id: "emblem-line",
          invoiceId: "ant",
          description: "Emblem Grey 450 μm 640mm x 450mm filmed",
          statedUnit: "sheet",
        }),
        line({
          id: "size-only",
          invoiceId: "ant",
          description: "White sheet 1220mm x 2440mm",
          statedUnit: "sheet",
        }),
      ],
      products: [kraft, emblem, wide, narrow],
      materials: [
        material({
          id: "foam-material",
          name: "Foamalite 2440 x 1220",
          purchaseUnit: "sheet",
          widthMm: 1220,
          heightMm: 2440,
        }),
      ],
    });

    assert.equal(built.groups.find((group) => group.lines.some((item) => item.id === "kraft-line"))?.productId, "kraft");
    assert.equal(built.groups.find((group) => group.lines.some((item) => item.id === "emblem-line"))?.productId, "emblem");
    const sizeOnly = built.groups.find((group) => group.lines.some((item) => item.id === "size-only"));
    assert.equal(sizeOnly?.productId, null);
    assert.equal(sizeOnly?.kind, "new_material");
    assert.deepEqual(sizeOnly?.similarMaterials.map((item) => item.id), ["foam-material"]);
  });

  it("keeps Quality Print Services ink colours apart and suggests litre for confirmation", () => {
    const invoices = [
      invoice({ id: "q1", supplierId: "qps", supplierName: "Quality Print Services" }),
      invoice({ id: "q2", supplierId: "qps", supplierName: "Quality Print Services" }),
    ];
    const lines = [
      line({ id: "y1", invoiceId: "q1", description: "770 UV Yellow Ink 1 litre", statedUnit: null, unitPrice: 84.45, lineTotal: 84.45 }),
      line({ id: "y2", invoiceId: "q2", description: "770 UV Yellow Ink 1 litre", statedUnit: null, unitPrice: 84.45, lineTotal: 84.45 }),
      line({ id: "k1", invoiceId: "q1", description: "770 UV Black Ink 1 litre", statedUnit: null, unitPrice: 84.45, lineTotal: 84.45 }),
    ];
    const groups = review({ invoices, lines }).groups.filter((group) => group.lines.some((item) => item.id.startsWith("y") || item.id === "k1"));

    assert.equal(groups.find((group) => group.lines.some((item) => item.id === "y1"))?.lineCount, 2);
    assert.notEqual(
      groups.find((group) => group.lines.some((item) => item.id === "y1"))?.id,
      groups.find((group) => group.lines.some((item) => item.id === "k1"))?.id
    );
    const yellow = groups.find((group) => group.lines.some((item) => item.id === "y1"));

    assert.equal(groups[0].purchaseUnit, null);
    assert.equal(yellow?.suggestedUnit, "litre");
    assert.match(yellow?.warnings.join(" ") ?? "", /Confirm litre before saving/);
    const saved = planBulkDecision(review({ invoices, lines }).groups, lines.filter((item) => item.id.startsWith("y")), [], {
      action: "set_purchase_unit",
      confirmed: true,
      unit: "litre",
      lineIds: ["y1", "y2"],
    });

    assert.equal(saved.ok, true);
    if (saved.ok && saved.write?.type === "set_purchase_unit") {
      assert.equal(saved.write.unit, "litre");
      assert.equal(saved.write.createPrice, false);
    }
  });

  it("does not copy a missing PPB HIPS sheet size from another SKU", () => {
    const invoices = [invoice({ id: "ppb", supplierId: "ppb", supplierName: "PPB" })];
    const lines = [
      line({
        id: "hips-a",
        invoiceId: "ppb",
        description: "WHITE GLOSS HIPS 1MM",
        sku: "STYWH-1000-2440-1220",
        statedUnit: null,
        unitPrice: 27.5,
        lineTotal: 27.5,
      }),
      line({
        id: "hips-b",
        invoiceId: "ppb",
        description: "WHITE MATT HIPS 1MM 3050mm x 1524mm",
        sku: "STYWH-1000-3050-1528",
        statedUnit: null,
        unitPrice: 30,
        lineTotal: 30,
      }),
    ];
    const built = review({ invoices, lines });
    const missing = built.groups.find((group) => group.lines.some((item) => item.id === "hips-a"));
    const sized = built.groups.find((group) => group.lines.some((item) => item.id === "hips-b"));

    assert.notEqual(missing?.id, sized?.id);
    assert.equal(missing?.widthMm, null);
    assert.match(missing?.warnings.join(" ") ?? "", /Do not copy the size/);
  });

  it("keeps All Print slit widths apart from the master roll", () => {
    const master = product({
      id: "su3",
      supplierId: "all-print",
      sku: "SU3-70-1560",
      description: "SU3-70 SEMI-MATT UV SEAL 50M X 1560MM",
      materialName: "SU3-70 1560",
      widthMm: 1560,
      lengthMm: 50000,
    });
    const built = review({
      invoices: [invoice({ id: "slit", supplierId: "all-print", supplierName: "All Print Supplies" })],
      lines: [
        line({
          id: "slit-line",
          invoiceId: "slit",
          description: "SU3-70 SEMI-MATT UV SEAL 50M X 1560MM SLIT TO 1510MM",
          statedUnit: "roll",
          reviewStatus: "needs_review",
        }),
      ],
      products: [master],
    });
    const group = built.groups[0];

    assert.notEqual(group.productId, master.id);
    assert.equal(group.widthMm, 1510);
    assert.match(group.warnings.join(" "), /not matched to the master roll/);
  });

  it("offers 1p and 2p differences for an explicit rounding decision and keeps other repairs blocked", () => {
    const built = review({
      invoices: [
        invoice({ id: "penny", supplierId: "pyramid", supplierName: "Pyramid", number: "SI1312902" }),
        invoice({ id: "two-p", supplierId: "all-print", supplierName: "All Print Supplies", number: "143155" }),
        invoice({
          id: "empty-a",
          supplierId: "all-print",
          supplierName: "All Print Supplies",
          number: "139351",
          extractionWarnings: ["No invoice lines could be read from the text."],
          processingStatus: "extraction_error",
        }),
        invoice({
          id: "empty-b",
          supplierId: "all-print",
          supplierName: "All Print Supplies",
          number: "146019",
          extractionWarnings: ["No invoice lines could be read from the text."],
          processingStatus: "extraction_error",
        }),
        invoice({ id: "wide", supplierId: "pyramid", supplierName: "Pyramid", number: "SI1300001" }),
        invoice({
          id: "blackback",
          supplierId: null,
          supplierName: null,
          number: null,
          extractionWarnings: ["Supplier not found"],
          processingStatus: "extraction_error",
        }),
      ],
      lines: [
        line({
          id: "penny-line",
          invoiceId: "penny",
          description: "E-flute 1067mm x 1575mm",
          statedUnit: "sheet",
          unitPrice: 98.68,
          lineTotal: 98.69,
          reviewStatus: "extraction_error",
          mathsWarning: "Quantity × unit price is £98.68, but the line total is £98.69.",
        }),
        line({
          id: "two-line",
          invoiceId: "two-p",
          description: "SU3-70 50M X 1350MM To convert",
          unitPrice: 254.42,
          lineTotal: 508.82,
          quantity: 2,
          reviewStatus: "extraction_error",
          mathsWarning: "Quantity × unit price is £508.84, but the line total is £508.82.",
        }),
        line({
          id: "wide-line",
          invoiceId: "wide",
          description: "Board",
          statedUnit: "sheet",
          unitPrice: 10,
          lineTotal: 10.03,
          reviewStatus: "extraction_error",
          mathsWarning: "Quantity × unit price is £10.00, but the line total is £10.03.",
        }),
        line({
          id: "black-line",
          invoiceId: "blackback",
          description: "1 RL BLACKBACK FABRIC 2.5M X 91M",
          statedUnit: null,
          reviewStatus: "needs_review",
        }),
      ],
    });
    const repair = built.groups.filter((group) => group.kind === "repair");

    const rounding = built.groups.filter((group) => group.kind === "rounding");
    const penny = rounding.find((group) => group.lines.some((item) => item.id === "penny-line"));
    const twoPence = rounding.find((group) => group.lines.some((item) => item.id === "two-line"));

    assert.equal(repair.length, 4);
    assert.equal(repair.every((group) => group.canApply === false), true);
    assert.equal(rounding.length, 2);
    assert.equal(penny?.canApply, true);
    assert.equal(twoPence?.canApply, true);
    assert.equal(penny?.title, "1p rounding difference");
    assert.equal(twoPence?.title, "2p rounding difference");
    assert.match(built.groups.find((group) => group.lines.some((item) => item.id === "wide-line"))?.warnings.join(" ") ?? "", /not reliable|line total/i);
    assert.match(built.groups.find((group) => group.lines.some((item) => item.id === "black-line"))?.warnings.join(" ") ?? "", /no supplier/);
    assert.equal(cleanInvoiceProductName("SU3-70 50M X 1350MM To convert"), "SU3-70 50M X 1350MM");
    assert.equal(
      built.groups.find((group) => group.lines.some((item) => item.id === "two-line"))?.lines[0]?.description,
      "SU3-70 50M X 1350MM To convert"
    );
  });

  it("leaves BL and PK unmapped", () => {
    const built = review({
      invoices: [invoice({ id: "units", supplierId: "antalis", supplierName: "Antalis" })],
      lines: [
        line({ id: "bl", invoiceId: "units", description: "Bubble wrap", statedUnit: "BL", sku: "611473" }),
        line({ id: "pk", invoiceId: "units", description: "Wristbands", statedUnit: "PK", sku: "617981" }),
      ],
    });

    assert.equal(built.groups.every((group) => group.kind === "purchase_unit" && group.purchaseUnit === null), true);
    assert.match(built.groups.find((group) => group.sku === "611473")?.warnings.join(" ") ?? "", /BL is not a catalogue unit/);
    assert.match(built.groups.find((group) => group.sku === "617981")?.warnings.join(" ") ?? "", /PK is not a catalogue unit/);
  });
});

describe("bulk invoice review decisions", () => {
  it("ignores only the selected charge lines and does not create a future rule", () => {
    const invoices = [invoice({ id: "freight", supplierId: "papergraphics", supplierName: "Papergraphics" })];
    const lines = [
      line({ id: "a", invoiceId: "freight", description: "Freight", statedUnit: null, unitPrice: 10, lineTotal: 10 }),
      line({ id: "b", invoiceId: "freight", description: "Freight", statedUnit: null, unitPrice: 12, lineTotal: 12 }),
    ];
    const built = review({ invoices, lines });
    const plan = planBulkDecision(built.groups, lines, [], {
      action: "ignore_charges",
      confirmed: true,
      lineIds: ["a"],
    });

    assert.equal(plan.ok, true);
    if (plan.ok) {
      assert.equal(plan.appliesToFutureInvoices, false);
      assert.deepEqual(plan.lineIds, ["a"]);
      assert.equal(plan.write?.type, "ignore_charges");
      if (plan.write?.type === "ignore_charges") {
        assert.equal(plan.write.createIgnoreRule, false);
        assert.equal(plan.write.createMaterial, false);
        assert.equal(plan.write.createPrice, false);
      }
    }
  });

  it("is idempotent when the charge is already ignored and conflicts when a line changed", () => {
    const invoices = [invoice({ id: "freight" })];
    const open = line({ id: "a", invoiceId: "freight", description: "Freight", statedUnit: null });
    const built = review({ invoices, lines: [open] });
    const repeated = planBulkDecision(
      built.groups,
      [{ ...open, reviewStatus: "ignored" }],
      [],
      { action: "ignore_charges", confirmed: true, lineIds: ["a"] }
    );
    const stale = planBulkDecision(
      built.groups,
      [{ ...open, reviewStatus: "processed" }],
      [],
      { action: "ignore_charges", confirmed: true, lineIds: ["a"] }
    );

    assert.equal(repeated.ok && repeated.alreadyComplete, true);
    assert.equal(repeated.ok && repeated.write, null);
    assert.equal(stale.ok, false);
    if (!stale.ok) {
      assert.equal(stale.status, 409);
    }
  });

  it("rejects a line from another group and a repair line", () => {
    const invoices = [
      invoice({ id: "one", supplierId: "papergraphics" }),
      invoice({ id: "two", supplierId: "pyramid", number: "SI1312902" }),
    ];
    const lines = [
      line({ id: "freight", invoiceId: "one", description: "Freight", statedUnit: null }),
      line({
        id: "penny",
        invoiceId: "two",
        description: "E-flute",
        statedUnit: "sheet",
        unitPrice: 98.68,
        lineTotal: 98.69,
        reviewStatus: "extraction_error",
        mathsWarning: "1p",
      }),
    ];
    const built = review({ invoices, lines });
    const mixed = planBulkDecision(built.groups, lines, [], {
      action: "ignore_charges",
      confirmed: true,
      lineIds: ["freight", "penny"],
    });
    const repair = planBulkDecision(built.groups, lines, [], {
      action: "approve_current_price",
      confirmed: true,
      approveCurrent: true,
      lineIds: ["penny"],
    });

    const recorded = planBulkDecision(built.groups, lines, [], {
      action: "accept_rounding",
      confirmed: true,
      acceptRounding: true,
      lineIds: ["penny"],
    });
    const unconfirmed = planBulkDecision(built.groups, lines, [], {
      action: "accept_rounding",
      confirmed: true,
      acceptRounding: false,
      lineIds: ["penny"],
    });

    assert.equal(mixed.ok, false);
    assert.equal(repair.ok, false);
    assert.equal(unconfirmed.ok, false);
    assert.equal(recorded.ok, true);
    if (recorded.ok && recorded.write?.type === "accept_rounding") {
      assert.equal(recorded.write.changesInvoiceTotals, false);
    }
  });

  it("requires an explicit product and does not save a future description mapping", () => {
    const existing = product({
      id: "kraft",
      supplierId: "antalis",
      description: "Ribbed Kraft Paper, Master'in Access 90 g/m2, 600 mm x 220.00 m",
      materialName: "Kraft",
    });
    const other = product({ id: "other", supplierId: "antalis", description: "A completely different product description" });
    const invoices = [invoice({ id: "ant", supplierId: "antalis" })];
    const rows = [
      line({
        id: "kraft",
        invoiceId: "ant",
        description: "Ribbed Kraft Paper, Master'in Access 90 g/m2, 600 mm x 220.00 m, buff",
      }),
    ];
    const built = review({ invoices, lines: rows, products: [existing, other] });
    const missing = planBulkDecision(built.groups, rows, [], {
      action: "confirm_product",
      confirmed: true,
      productId: "other",
      lineIds: ["kraft"],
    });
    const confirmed = planBulkDecision(built.groups, rows, [], {
      action: "confirm_product",
      confirmed: true,
      productId: "kraft",
      lineIds: ["kraft"],
    });

    assert.equal(missing.ok, false);
    assert.equal(confirmed.ok, true);
    if (confirmed.ok && confirmed.write?.type === "confirm_product") {
      assert.equal(confirmed.write.createMapping, false);
      assert.equal(confirmed.write.createPrice, false);
    }
  });

  it("keeps a historical price without changing the current price, and requires a separate approval", () => {
    const dibond = product({
      id: "dibond",
      supplierId: "pyramid",
      sku: "ALUED32422",
      materialName: "Dibond",
      purchaseUnit: "sheet",
      currentPriceUnit: "sheet",
      currentPrice: 42,
      currentPriceId: "current",
      currentEffectiveDate: "2026-01-01",
    });
    const invoices = [invoice({ id: "old", supplierId: "pyramid", date: "2024-03-01" })];
    const rows = [
      line({
        id: "old-line",
        invoiceId: "old",
        sku: "ALUED32422",
        statedUnit: "sheet",
        unitPrice: 25.34,
        lineTotal: 25.34,
        reviewStatus: "price_change",
        matchedProductId: "dibond",
        matchConfidence: "high",
      }),
    ];
    const built = review({ invoices, lines: rows, products: [dibond] });
    const kept = planBulkDecision(built.groups, rows, [], {
      action: "keep_historical_price",
      confirmed: true,
      lineIds: ["old-line"],
    });
    const unconfirmed = planBulkDecision(built.groups, rows, [], {
      action: "approve_current_price",
      confirmed: true,
      approveCurrent: false,
      lineIds: ["old-line"],
    });
    const approved = planBulkDecision(built.groups, rows, [], {
      action: "approve_current_price",
      confirmed: true,
      approveCurrent: true,
      lineIds: ["old-line"],
    });

    assert.equal(kept.ok, true);
    if (kept.ok && kept.write?.type === "keep_historical_price") {
      assert.equal(kept.write.changesCurrentPrice, false);
      assert.equal(kept.write.createPrice, false);
      assert.equal(kept.write.changesSupplierPreference, false);
      assert.equal(kept.write.changesQuotes, false);
    }
    assert.equal(unconfirmed.ok, false);
    assert.equal(approved.ok, true);
    if (approved.ok && approved.write?.type === "approve_current_price") {
      assert.equal(approved.write.changesCurrentPrice, true);
      assert.equal(approved.write.priceCount, 1);
    }
  });

  it("does not map BL to sheets and does not create a material while the unit is unknown", () => {
    const rows = [
      line({ id: "bl", invoiceId: "units", description: "Bubble wrap", statedUnit: "BL", sku: "611473" }),
    ];
    const built = review({
      invoices: [invoice({ id: "units", supplierId: "antalis" })],
      lines: rows,
    });
    const guessed = planBulkDecision(built.groups, rows, [], {
      action: "set_purchase_unit",
      confirmed: true,
      unit: "BL",
      lineIds: ["bl"],
    });
    const chosen = planBulkDecision(built.groups, rows, [], {
      action: "set_purchase_unit",
      confirmed: true,
      unit: "roll",
      lineIds: ["bl"],
    });
    const created = planBulkDecision(built.groups, rows, [], {
      action: "create_material",
      confirmed: true,
      name: "Bubble wrap",
      openingPrice: 33.29,
      acknowledgedSimilar: true,
      lineIds: ["bl"],
    });

    assert.equal(guessed.ok, false);
    assert.equal(chosen.ok, true);
    if (chosen.ok && chosen.write?.type === "set_purchase_unit") {
      assert.equal(chosen.write.unit, "roll");
      assert.equal(chosen.write.createMaterial, false);
    }
    assert.equal(created.ok, false);
  });

  it("removes order notes from a new material name and blocks a catalogue duplicate", () => {
    const rows = [
      line({
        id: "one",
        invoiceId: "new",
        description: "P65W WHITE GLOSS SEE GG",
        statedUnit: "linear metre",
        unitPrice: 11.19,
        lineTotal: 11.19,
      }),
      line({
        id: "two",
        invoiceId: "new",
        description: "P65W WHITE GLOSS **ADDITION TO ORDER**",
        statedUnit: "linear metre",
        unitPrice: 11.19,
        lineTotal: 11.19,
      }),
    ];
    const materials = [
      material({
        id: "existing",
        name: "P65W WHITE GLOSS",
        purchaseUnit: "linear_metre",
      }),
    ];
    const built = review({
      invoices: [invoice({ id: "new", supplierId: "all-print", supplierName: "All Print Supplies" })],
      lines: rows,
      materials,
    });
    const plan = planBulkDecision(built.groups, rows, materials, {
      action: "create_material",
      confirmed: true,
      name: "P65W WHITE GLOSS SEE GG",
      openingPrice: 11.19,
      acknowledgedSimilar: false,
      lineIds: ["one", "two"],
    });

    assert.equal(built.groups[0]?.lineCount, 2);
    assert.equal(built.groups[0]?.proposedName, "P65W WHITE GLOSS");
    assert.equal(plan.ok, false);
    if (!plan.ok) {
      assert.match(plan.error, /already exists/);
    }
  });

  it("does not apply a decision that was not confirmed", () => {
    const rows = [line({ id: "a", invoiceId: "freight", description: "Carriage", statedUnit: null })];
    const built = review({ invoices: [invoice({ id: "freight" })], lines: rows });
    const plan = planBulkDecision(built.groups, rows, [], {
      action: "ignore_charges",
      confirmed: false,
      lineIds: ["a"],
    });

    assert.equal(plan.ok, false);
  });
});

describe("existing supplier-product link confirmation", () => {
  const description = "Foamalite, XPRESS, Filmed, white 5.000mm 1220mm x 2440mm, 7301037";

  function foamProduct(overrides: Partial<InvoiceMatchProduct> = {}) {
    return product({
      id: "81e453a5-589d-432c-936e-42c02e5a002e",
      supplierId: "antalis",
      description: "Foamalite, XPRESS, Filmed, white 5.000mm 1220mm x 2440mm",
      materialName: "Foamalite 5mm PVC 2440mm x 1220mm",
      purchaseUnit: "sheet",
      thicknessMm: 5,
      colour: "White",
      widthMm: 2440,
      heightMm: 1220,
      currentPrice: 23.77,
      currentPriceUnit: "sheet",
      currentPriceId: "foam-price",
      currentEffectiveDate: "2026-10-01",
      ...overrides,
    });
  }

  function foamLine(overrides: Partial<BulkReviewSourceLine> = {}) {
    return line({
      id: "57ce87ca-c6b2-47e8-88e9-5f88f37b5909",
      invoiceId: "6701397556",
      description,
      sku: "609745",
      quantity: 15,
      statedUnit: "sheet",
      unitPrice: 23.77,
      lineTotal: 356.55,
      reviewStatus: "needs_review",
      matchedProductId: "81e453a5-589d-432c-936e-42c02e5a002e",
      matchConfidence: "medium",
      ...overrides,
    });
  }

  function foamReview(catalogue = foamProduct(), row = foamLine()) {
    const invoices = [invoice({ id: "6701397556", supplierId: "antalis", supplierName: "Antalis", number: "6701397556", date: "2026-07-20" })];
    return { invoices, row, catalogue, built: review({ invoices, lines: [row], products: [catalogue] }) };
  }

  it("confirms the Foamalite link when the price matches and creates no future rule", () => {
    const { built, row, catalogue } = foamReview();
    const group = built.groups.find((item) => item.lines.some((line) => line.id === row.id));
    const plan = planBulkDecision(built.groups, [row], [], {
      action: "confirm_existing_link",
      confirmed: true,
      productId: catalogue.id,
      lineIds: [row.id],
    }, [catalogue]);

    assert.equal(group?.kind, "existing_link");
    assert.equal(group?.canApply, true);
    assert.equal(existingLinkReviewStatus(catalogue, row.unitPrice, row.statedUnit), "processed");
    assert.equal(plan.ok, true);
    if (plan.ok && plan.write?.type === "confirm_existing_link") {
      assert.equal(plan.write.productId, catalogue.id);
      assert.equal(plan.write.createMapping, false);
      assert.equal(plan.write.createPrice, false);
      assert.equal(plan.write.createsMaterial, false);
    } else {
      assert.fail("expected an existing-link confirmation");
    }
  });

  it("leaves a different invoice price for a price decision and a missing price unresolved", () => {
    const different = foamProduct({ currentPrice: 25 });
    const missing = foamProduct({ currentPrice: null, currentPriceUnit: null, currentPriceId: null });
    const row = foamLine();

    assert.equal(existingLinkReviewStatus(different, row.unitPrice, row.statedUnit), "price_change");
    assert.equal(existingLinkReviewStatus(missing, row.unitPrice, row.statedUnit), "needs_review");

    for (const catalogue of [different, missing]) {
      const { built } = foamReview(catalogue, row);
      const plan = planBulkDecision(built.groups, [row], [], {
        action: "confirm_existing_link",
        confirmed: true,
        productId: catalogue.id,
        lineIds: [row.id],
      }, [catalogue]);

      assert.equal(plan.ok, true);
      if (plan.ok) {
        assert.equal(plan.write?.type, "confirm_existing_link");
      }
    }
  });

  it("rejects a different supplier, a different size, and a repeat that is already confirmed", () => {
    const wrongSupplier = foamProduct({ supplierId: "pyramid" });
    const wrongSize = foamProduct({ widthMm: 3050, heightMm: 1560 });
    const supplierReview = foamReview(wrongSupplier);
    const sizeReview = foamReview(wrongSize);
    const supplierPlan = planBulkDecision(supplierReview.built.groups, [supplierReview.row], [], {
      action: "confirm_existing_link",
      confirmed: true,
      productId: wrongSupplier.id,
      lineIds: [supplierReview.row.id],
    }, [wrongSupplier]);
    const sizePlan = planBulkDecision(sizeReview.built.groups, [sizeReview.row], [], {
      action: "confirm_existing_link",
      confirmed: true,
      productId: wrongSize.id,
      lineIds: [sizeReview.row.id],
    }, [wrongSize]);
    const { built, row, catalogue } = foamReview();
    const repeated = planBulkDecision(built.groups, [{ ...row, reviewStatus: "processed", matchConfidence: "high" }], [], {
      action: "confirm_existing_link",
      confirmed: true,
      productId: catalogue.id,
      lineIds: [row.id],
    }, [catalogue]);

    assert.equal(supplierPlan.ok, false);
    if (!supplierPlan.ok) {
      assert.match(supplierPlan.error, /different supplier/);
    }
    assert.equal(sizePlan.ok, false);
    if (!sizePlan.ok) {
      assert.match(sizePlan.error, /sheet size/);
    }
    assert.equal(repeated.ok && repeated.alreadyComplete, true);
    assert.equal(repeated.ok && repeated.write, null);
  });

  it("does not create a future rule or rewrite invoice amounts in the database function", async () => {
    const panel = await readFile(new URL("../../../components/materials/bulk-review-panel.tsx", import.meta.url), "utf8");
    const action = await readFile(new URL("./bulk-review-actions.ts", import.meta.url), "utf8");
    const migration = await readFile(
      new URL("../../../supabase/migrations/20261102153000_confirm_existing_invoice_links.sql", import.meta.url),
      "utf8"
    );

    assert.match(panel, /Confirm the existing match/);
    assert.match(action, /confirm_existing_bulk_invoice_links/);
    assert.match(action, /verifyApprovedAdmin/);
    assert.match(migration, /is_approved_candid_admin/);
    assert.match(migration, /auth\.uid\(\) IS DISTINCT FROM p_actor_id/);
    assert.match(migration, /product_match_confirmed/);
    assert.match(migration, /'futureRule', false/);
    assert.match(migration, /WHEN v_invoice_price IS NULL OR v_current\.id IS NULL/);
    assert.match(migration, /invoice_existing_link_dimension_conflict/);
    assert.match(migration, /The invoice sheet size does not match the catalogue product/);
    assert.match(migration, /The invoice roll size does not match the catalogue product/);
    assert.match(migration, /The invoice thickness does not match the catalogue product/);
    assert.match(migration, /The invoice SKU does not match the supplier product/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.invoice_existing_link_dimension_conflict/);
    assert.doesNotMatch(migration, /supplier_product_description_mappings|INSERT INTO public\.material_prices|INSERT INTO public\.supplier_invoice_historical_prices/);
    assert.doesNotMatch(migration, /raw_description\s*=|raw_quantity\s*=|raw_unit_price\s*=|raw_line_total\s*=|raw_supplier_sku\s*=/);
  });
});

describe("bulk invoice review safety source", () => {
  it("keeps an ignored invoice with a subtotal warning visible without reopening its lines", () => {
    const warning = "The line totals do not add up to the subtotal.";
    const built = review({
      invoices: [
        invoice({
          id: "142049",
          supplierId: "all-print",
          supplierName: "All Print Supplies",
          number: "142049",
          extractionWarnings: [warning],
          processingStatus: "extraction_error",
          subtotal: 336.3,
          vat: 67.26,
          total: 403.56,
        }),
        invoice({
          id: "144944",
          supplierId: "all-print",
          supplierName: "All Print Supplies",
          number: "144944",
          extractionWarnings: [warning],
          processingStatus: "extraction_error",
          subtotal: 2317.23,
          vat: 463.45,
          total: 2780.68,
        }),
        invoice({
          id: "146020",
          supplierId: "all-print",
          supplierName: "All Print Supplies",
          number: "146020",
          extractionWarnings: [warning],
          processingStatus: "extraction_error",
          subtotal: 2300.88,
          vat: 460.18,
          total: 2761.06,
        }),
        invoice({
          id: "processed",
          supplierId: "pyramid",
          supplierName: "Pyramid Display Materials",
          number: "SI1311911",
          processingStatus: "processed",
        }),
        invoice({
          id: "139351",
          supplierId: "all-print",
          supplierName: "All Print Supplies",
          number: "139351",
          extractionWarnings: ["No invoice lines could be read from the text."],
          processingStatus: "extraction_error",
        }),
        invoice({
          id: "146019",
          supplierId: "all-print",
          supplierName: "All Print Supplies",
          number: "146019",
          extractionWarnings: ["No invoice lines could be read from the text."],
          processingStatus: "extraction_error",
        }),
      ],
      lines: [
        line({ id: "courier-a", invoiceId: "142049", description: "APS DELIVERY", reviewStatus: "ignored" }),
        line({ id: "courier-b", invoiceId: "144944", description: "SAME DAY COURIERS", reviewStatus: "ignored" }),
        line({ id: "courier-c", invoiceId: "146020", description: "SAME DAY COURIERS", reviewStatus: "ignored" }),
        line({ id: "done", invoiceId: "processed", reviewStatus: "processed" }),
      ],
    });
    const repairs = built.groups.filter((group) => group.kind === "repair");
    const warned = repairs.filter((group) => group.warnings.includes(warning));

    assert.deepEqual(
      warned.map((group) => group.invoices[0]?.number),
      ["142049", "144944", "146020"]
    );
    assert.equal(warned.every((group) => group.canApply === false && group.lines.length === 0), true);
    assert.equal(warned[0]?.total, 403.56);
    assert.equal(warned[0]?.supplierName, "All Print Supplies");
    assert.equal(built.groups.some((group) => group.lines.some((item) => item.id.startsWith("courier"))), false);
    assert.equal(built.groups.some((group) => group.invoices.some((item) => item.number === "SI1311911")), false);
    assert.equal(repairs.some((group) => group.invoices[0]?.number === "139351"), true);
    assert.equal(repairs.some((group) => group.invoices[0]?.number === "146019"), true);
    assert.equal(built.summary.openLineCount, 0);
  });

  it("keeps the page and the write path admin-only and free of future rules", async () => {
    const page = await readFile(
      new URL("../../../app/admin/materials/invoices/bulk-review/page.tsx", import.meta.url),
      "utf8"
    );
    const panel = await readFile(
      new URL("../../../components/materials/bulk-review-panel.tsx", import.meta.url),
      "utf8"
    );
    const action = await readFile(new URL("./bulk-review-actions.ts", import.meta.url), "utf8");
    const migration = await readFile(
      new URL("../../../supabase/migrations/20261027180000_bulk_invoice_review.sql", import.meta.url),
      "utf8"
    );

    const bulkOnly = migration.slice(0, migration.indexOf("-- Align the single-line material creator"));
    const retain = bulkOnly.slice(
      bulkOnly.indexOf("FUNCTION public.retain_bulk_historical_invoice_prices"),
      bulkOnly.indexOf("FUNCTION public.approve_bulk_invoice_price")
    );
    const rounding = bulkOnly.slice(
      bulkOnly.indexOf("FUNCTION public.accept_bulk_rounding_discrepancy"),
      bulkOnly.indexOf("REVOKE ALL ON FUNCTION public.ignore_bulk_invoice_charges")
    );

    assert.match(page, /requireAdminPageAccess/);
    assert.match(panel, /Record historical price only/);
    assert.match(panel, /Approve a new current price/);
    assert.match(panel, /Record the rounding difference/);
    assert.doesNotMatch(action, /createAdminClient|supplier_invoice_ignore_rules|supplier_product_description_mappings/);
    assert.match(action, /verifyApprovedAdmin/);
    assert.match(action, /accept_bulk_rounding_discrepancy/);
    assert.doesNotMatch(bulkOnly, /supplier_invoice_ignore_rules|supplier_product_description_mappings|DELETE FROM|quote_/);
    assert.match(bulkOnly, /is_approved_candid_admin/);
    assert.match(bulkOnly, /pg_advisory_xact_lock/);
    assert.match(bulkOnly, /unique_violation/);
    assert.equal(bulkOnly.match(/INSERT INTO public\.material_prices/g)?.length, 2);
    assert.match(retain, /INSERT INTO public\.supplier_invoice_historical_prices/);
    assert.doesNotMatch(retain, /INSERT INTO public\.material_prices/);
    assert.match(rounding, /rounding_discrepancy/);
    assert.doesNotMatch(rounding, /raw_quantity\s*=|raw_unit_price\s*=|raw_line_total\s*=|subtotal\s*=/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.refresh_supplier_invoice_processing_status/);
    assert.match(migration, /'litre'/);
  });
});
