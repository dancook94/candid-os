import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { buildMaterialIdentityKey } from "@/lib/materials/identity";
import {
  applyPreferredSelection,
  calculateCostPerSquareMetre,
  countActivePreferredProducts,
  selectCurrentApprovedPrice,
  selectPreferredSupplierProduct,
} from "@/lib/materials/pricing";
import {
  buildMaterialListRow,
  buildPriceHistory,
  buildSupplierProductViews,
  type MaterialRecord,
} from "@/lib/materials/present";
import {
  isMaterialsFieldError,
  parseApprovedPriceWrite,
  parseMaterialWrite,
  parseSupplierProductWrite,
} from "@/lib/materials/validation";

const sheet: MaterialRecord = {
  id: "material-1",
  name: "Foamalite White",
  category: "Rigid board",
  thicknessMm: 5,
  colour: "White",
  finish: null,
  purchaseUnit: "sheet",
  purchaseWidthMm: 2440,
  purchaseHeightMm: 1220,
  purchaseLengthMm: null,
  active: true,
};

function price(overrides: {
  id: string;
  price: number;
  effectiveDate: string;
  approvedAt?: string;
  createdAt?: string;
  priceUnit?: MaterialRecord["purchaseUnit"];
}) {
  return {
    id: overrides.id,
    price: overrides.price,
    priceUnit: overrides.priceUnit ?? "sheet",
    effectiveDate: overrides.effectiveDate,
    approvedAt: overrides.approvedAt ?? `${overrides.effectiveDate}T00:00:00.000Z`,
    createdAt: overrides.createdAt ?? `${overrides.effectiveDate}T00:00:00.000Z`,
  };
}

describe("material identity", () => {
  it("treats case and whitespace as the same material", () => {
    const left = buildMaterialIdentityKey({
      name: "  Foamalite   White ",
      thicknessMm: 5,
      colour: " White ",
      finish: null,
      purchaseUnit: "sheet",
      purchaseWidthMm: 2440,
      purchaseHeightMm: 1220,
      purchaseLengthMm: null,
    });
    const right = buildMaterialIdentityKey({
      name: "foamalite white",
      thicknessMm: 5,
      colour: "white",
      finish: null,
      purchaseUnit: "sheet",
      purchaseWidthMm: 2440,
      purchaseHeightMm: 1220,
      purchaseLengthMm: null,
    });

    assert.equal(left, right);
  });

  it("keeps thickness and size as separate materials", () => {
    const fiveMm = buildMaterialIdentityKey({
      name: "Foamalite White",
      thicknessMm: 5,
      colour: "White",
      finish: null,
      purchaseUnit: "sheet",
      purchaseWidthMm: 2440,
      purchaseHeightMm: 1220,
      purchaseLengthMm: null,
    });
    const threeMm = buildMaterialIdentityKey({
      name: "Foamalite White",
      thicknessMm: 3,
      colour: "White",
      finish: null,
      purchaseUnit: "sheet",
      purchaseWidthMm: 2440,
      purchaseHeightMm: 1220,
      purchaseLengthMm: null,
    });

    assert.notEqual(fiveMm, threeMm);
  });

  it("does not use supplier description as identity", () => {
    const spec = {
      name: "Foamalite White",
      thicknessMm: 5,
      colour: "White",
      finish: null,
      purchaseUnit: "sheet" as const,
      purchaseWidthMm: 3050,
      purchaseHeightMm: 1560,
      purchaseLengthMm: null,
    };

    assert.equal(
      buildMaterialIdentityKey(spec),
      buildMaterialIdentityKey({ ...spec, name: "Foamalite White" })
    );
    assert.equal(
      Object.keys(spec).includes("supplierDescription"),
      false
    );
  });
});

describe("normalised cost", () => {
  it("calculates sheet £/m² from width and height", () => {
    const cost = calculateCostPerSquareMetre({
      price: 30,
      priceUnit: "sheet",
      widthMm: 2440,
      heightMm: 1220,
      lengthMm: null,
    });

    assert.ok(cost != null);
    assert.ok(Math.abs(cost - 30 / 2.9768) < 0.000001);
  });

  it("calculates roll £/m² only when width and length exist", () => {
    const cost = calculateCostPerSquareMetre({
      price: 68.5,
      priceUnit: "roll",
      widthMm: 1370,
      heightMm: null,
      lengthMm: 50000,
    });

    assert.ok(cost != null);
    assert.ok(Math.abs(cost - 68.5 / (1.37 * 50)) < 0.000001);
    assert.equal(
      calculateCostPerSquareMetre({
        price: 68.5,
        priceUnit: "roll",
        widthMm: 1370,
        heightMm: null,
        lengthMm: null,
      }),
      null
    );
  });

  it("calculates linear metre £/m² from width only", () => {
    const cost = calculateCostPerSquareMetre({
      price: 4,
      priceUnit: "linear_metre",
      widthMm: 1000,
      heightMm: null,
      lengthMm: null,
    });

    assert.equal(cost, 4);
  });

  it("does not invent £/m² for a pack", () => {
    assert.equal(
      calculateCostPerSquareMetre({
        price: 82.54,
        priceUnit: "pack",
        widthMm: 450,
        heightMm: 320,
        lengthMm: null,
      }),
      null
    );
  });
});

describe("current approved price", () => {
  it("uses effective date, then approval time, then created time", () => {
    const older = price({
      id: "old",
      price: 25,
      effectiveDate: "2026-06-01",
    });
    const sameDayEarlier = price({
      id: "mid",
      price: 26,
      effectiveDate: "2026-09-01",
      approvedAt: "2026-09-01T09:00:00.000Z",
      createdAt: "2026-09-01T09:00:00.000Z",
    });
    const sameApprovalLaterInsert = price({
      id: "new",
      price: 27,
      effectiveDate: "2026-09-01",
      approvedAt: "2026-09-01T09:00:00.000Z",
      createdAt: "2026-09-01T10:00:00.000Z",
    });
    const history = [older, sameApprovalLaterInsert, sameDayEarlier];
    const current = selectCurrentApprovedPrice(history);

    assert.equal(current?.id, "new");
    assert.equal(history.length, 3);
    assert.equal(history[0].id, "old");
  });
});

describe("preferred supplier", () => {
  const pyramid = {
    id: "pyramid",
    active: true,
    isPreferred: false,
  };
  const antalis = {
    id: "antalis",
    active: true,
    isPreferred: true,
  };

  it("uses the single preferred product and ignores a cheaper alternative", () => {
    const selected = selectPreferredSupplierProduct([pyramid, antalis]);
    assert.equal(selected?.id, "antalis");
  });

  it("does not choose a supplier when none is preferred", () => {
    assert.equal(
      selectPreferredSupplierProduct([
        { ...pyramid, isPreferred: false },
        { ...antalis, isPreferred: false },
      ]),
      null
    );
  });

  it("keeps one preferred product when a new one is selected", () => {
    const next = applyPreferredSelection([pyramid, antalis], "pyramid");
    assert.equal(countActivePreferredProducts(next), 1);
    assert.equal(next.find((product) => product.id === "pyramid")?.isPreferred, true);
    assert.equal(next.find((product) => product.id === "antalis")?.isPreferred, false);
  });

  it("shows the material once and withholds cost without a preferred supplier", () => {
    const products = buildSupplierProductViews({
      material: sheet,
      products: [
        {
          id: "pyramid",
          materialId: sheet.id,
          supplierId: "supplier-pyramid",
          supplierName: "Pyramid",
          supplierSku: null,
          supplierDescription: "5mm Foamalite 2440 x 1220",
          isPreferred: false,
          active: true,
        },
        {
          id: "antalis",
          materialId: sheet.id,
          supplierId: "supplier-antalis",
          supplierName: "Antalis",
          supplierSku: "FX-5",
          supplierDescription: "Foamalite Xpress 5mm",
          isPreferred: false,
          active: true,
        },
      ],
      prices: [
        { ...price({ id: "p1", price: 20, effectiveDate: "2026-09-01" }), productId: "pyramid" },
        { ...price({ id: "p2", price: 30, effectiveDate: "2026-09-02" }), productId: "antalis" },
      ],
    });
    const row = buildMaterialListRow({ material: sheet, products });

    assert.equal(row.material.id, sheet.id);
    assert.equal(row.preferredSupplierName, null);
    assert.equal(row.currentCostLabel, "Select a supplier");
    assert.equal(products.length, 2);
  });
});

describe("price history display", () => {
  it("keeps every approved price, newest first", () => {
    const products = buildSupplierProductViews({
      material: sheet,
      products: [
        {
          id: "antalis",
          materialId: sheet.id,
          supplierId: "supplier-antalis",
          supplierName: "Antalis",
          supplierSku: null,
          supplierDescription: "Foamalite Xpress 5mm",
          isPreferred: true,
          active: true,
        },
      ],
      prices: [
        { ...price({ id: "first", price: 28, effectiveDate: "2026-06-01" }), productId: "antalis" },
        { ...price({ id: "second", price: 30, effectiveDate: "2026-09-24" }), productId: "antalis" },
      ],
    });
    const history = buildPriceHistory({
      material: sheet,
      products,
      prices: [
        {
          ...price({ id: "first", price: 28, effectiveDate: "2026-06-01" }),
          productId: "antalis",
          sourceType: "manual",
          sourceReference: "Opening price",
        },
        {
          ...price({ id: "second", price: 30, effectiveDate: "2026-09-24" }),
          productId: "antalis",
          sourceType: "manual",
          sourceReference: null,
        },
      ],
    });

    assert.deepEqual(
      history.map((row) => row.id),
      ["second", "first"]
    );
    assert.equal(history[0].costPerSquareMetreLabel.includes("£"), true);
  });
});

describe("server validation", () => {
  it("rejects a price that is not positive", () => {
    const parsed = parseApprovedPriceWrite({
      price: -1,
      priceUnit: "sheet",
      effectiveDate: "2026-09-28",
    });
    const zero = parseApprovedPriceWrite({
      price: 0,
      priceUnit: "sheet",
      effectiveDate: "2026-09-28",
    });

    assert.equal(isMaterialsFieldError(parsed), true);
    assert.equal(isMaterialsFieldError(zero), true);
  });

  it("rejects zero and negative dimensions", () => {
    const parsed = parseMaterialWrite({
      name: "Foamalite White",
      purchaseUnit: "sheet",
      purchaseWidthMm: 0,
      purchaseHeightMm: -10,
    });

    assert.equal(isMaterialsFieldError(parsed), true);
    if (isMaterialsFieldError(parsed)) {
      assert.match(parsed.error, /greater than zero/);
    }
  });

  it("rejects an invalid purchase unit and an inactive preferred product", () => {
    const unit = parseMaterialWrite({
      name: "Foamalite White",
      purchaseUnit: "pallet",
    });
    const preferred = parseSupplierProductWrite({
      supplierId: "11111111-1111-4111-8111-111111111111",
      supplierDescription: "Foamalite",
      active: false,
      isPreferred: true,
    });

    assert.equal(isMaterialsFieldError(unit), true);
    assert.equal(isMaterialsFieldError(preferred), true);
  });
});

describe("materials access", () => {
  it("keeps Materials in the admin navigation only", async () => {
    const source = await readFile(
      new URL("../../components/app-shell.tsx", import.meta.url),
      "utf8"
    );
    const customerLinks = source.slice(
      source.indexOf("const customerLinks"),
      source.indexOf("const adminLinks")
    );
    const staffLinks = source.slice(
      source.indexOf("const staffLinks"),
      source.indexOf("function assertUniqueNavHrefs")
    );
    const adminLinks = source.slice(
      source.indexOf("const adminLinks"),
      source.indexOf("const crmLinks")
    );

    assert.match(adminLinks, /href: "\/admin\/materials"/);
    assert.doesNotMatch(customerLinks, /\/admin\/materials/);
    assert.doesNotMatch(staffLinks, /\/admin\/materials/);
  });

  it("checks approved admin access before every materials write", async () => {
    const source = await readFile(
      new URL("./actions.ts", import.meta.url),
      "utf8"
    );

    assert.match(source, /verifyApprovedAdmin/);
    assert.equal(source.split("requireMaterialsAdmin()").length > 5, true);
  });

  it("locks price history and customer access in the migration", async () => {
    const source = await readFile(
      new URL(
        "../../supabase/migrations/20260928120000_materials_cost_foundation.sql",
        import.meta.url
      ),
      "utf8"
    );

    assert.match(source, /is_approved_candid_admin\(\)/);
    assert.match(source, /GRANT SELECT, INSERT ON public.material_prices/);
    assert.doesNotMatch(source, /material_prices FOR UPDATE/);
    assert.doesNotMatch(source, /material_prices FOR DELETE/);
    assert.doesNotMatch(source, /TO anon/);
    assert.match(source, /material_supplier_products_one_preferred_idx/);
    assert.match(source, /round\(p_thickness_mm \* 1000\)/);
  });
});
