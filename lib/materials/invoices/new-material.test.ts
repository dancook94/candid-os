import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { buildMaterialIdentityKey } from "@/lib/materials/identity";
import {
  invoiceMaterialConflict,
  proposeMaterialFromInvoiceLine,
} from "@/lib/materials/invoices/new-material";

const BRITELINE = {
  description:
    "Briteline MT WHT Permanent 1370mm x 50m Monomeric Vinyl - Clear Adhesive (BLMVMWPC1370)",
  sku: "BLMV137MWPC",
  unit: "Roll",
  unitPrice: 89.1,
};

const greybackKey = buildMaterialIdentityKey({
  name: "Briteline Greyback Removable 1370mm x 50m",
  thicknessMm: null,
  colour: "White",
  finish: "Matt",
  purchaseUnit: "roll",
  purchaseWidthMm: 1370,
  purchaseHeightMm: null,
  purchaseLengthMm: 50000,
});

describe("create material from an invoice line", () => {
  it("proposes the permanent whiteback roll without copying the greyback finish", () => {
    const proposal = proposeMaterialFromInvoiceLine(BRITELINE);

    assert.equal(proposal.name, "Briteline Whiteback Permanent 1370mm x 50m");
    assert.equal(proposal.category, "Vinyl");
    assert.equal(proposal.colour, "White");
    assert.equal(proposal.finish, null);
    assert.equal(proposal.thicknessMm, null);
    assert.equal(proposal.purchaseUnit, "roll");
    assert.equal(proposal.purchaseWidthMm, 1370);
    assert.equal(proposal.purchaseHeightMm, null);
    assert.equal(proposal.purchaseLengthMm, 50000);
    assert.equal(proposal.supplierSku, "BLMV137MWPC");
    assert.equal(proposal.supplierDescription, BRITELINE.description);
    assert.equal(proposal.price, 89.1);
    assert.equal(proposal.preferred, true);
    assert.notEqual(
      buildMaterialIdentityKey({
        name: proposal.name,
        thicknessMm: proposal.thicknessMm,
        colour: proposal.colour,
        finish: proposal.finish,
        purchaseUnit: "roll",
        purchaseWidthMm: proposal.purchaseWidthMm,
        purchaseHeightMm: proposal.purchaseHeightMm,
        purchaseLengthMm: proposal.purchaseLengthMm,
      }),
      greybackKey
    );
  });

  it("blocks a duplicate material, SKU, description, resolved line, or second opening price", () => {
    const proposal = proposeMaterialFromInvoiceLine(BRITELINE);
    const base = {
      reviewStatus: "needs_review" as const,
      openingPriceAlreadyCreated: false,
      name: proposal.name,
      category: proposal.category,
      thicknessMm: proposal.thicknessMm,
      colour: proposal.colour,
      finish: proposal.finish,
      purchaseUnit: "roll" as const,
      purchaseWidthMm: 1370,
      purchaseHeightMm: null,
      purchaseLengthMm: 50000,
      supplierId: "pyramid",
      supplierSku: "BLMV137MWPC",
      supplierDescription: proposal.supplierDescription,
      existingIdentityKeys: [greybackKey],
      existingProducts: [
        {
          supplierId: "pyramid",
          sku: null,
          normalizedDescription: "briteline mt wht gb removable 1370mm x 50m monomeric vinyl - grey adhesive (blmvmwrg1370)",
        },
      ],
    };

    assert.equal(invoiceMaterialConflict(base), null);
    assert.match(
      invoiceMaterialConflict({
        ...base,
        existingIdentityKeys: [
          greybackKey,
          buildMaterialIdentityKey({
            name: proposal.name,
            thicknessMm: null,
            colour: "White",
            finish: null,
            purchaseUnit: "roll",
            purchaseWidthMm: 1370,
            purchaseHeightMm: null,
            purchaseLengthMm: 50000,
          }),
        ],
      }) ?? "",
      /already exists/
    );
    assert.match(
      invoiceMaterialConflict({
        ...base,
        existingProducts: [
          ...base.existingProducts,
          { supplierId: "pyramid", sku: "BLMV137MWPC", normalizedDescription: "other" },
        ],
      }) ?? "",
      /SKU/
    );
    assert.match(
      invoiceMaterialConflict({
        ...base,
        existingProducts: [
          {
            supplierId: "pyramid",
            sku: null,
            normalizedDescription: proposal.supplierDescription.toLowerCase(),
          },
        ],
      }) ?? "",
      /description/
    );
    assert.match(
      invoiceMaterialConflict({ ...base, reviewStatus: "processed" }) ?? "",
      /needs-review or unmatched/
    );
    assert.match(
      invoiceMaterialConflict({ ...base, openingPriceAlreadyCreated: true }) ?? "",
      /already created/
    );
    assert.equal(
      invoiceMaterialConflict({
        ...base,
        existingProducts: [
          { supplierId: "antalis", sku: "BLMV137MWPC", normalizedDescription: "other" },
        ],
      }),
      null
    );
  });

  it("reads both Foamalite sheet sizes from SI1297356 without using thickness as a dimension", () => {
    const lines = [
      {
        description: "3mm 3050x1560mm White P/E Foamalite Xpress Foam PVC (PQ120)",
        sku: "FLXP33015PE",
        unit: "SHEET",
        unitPrice: 25.479,
        thicknessMm: 3,
      },
      {
        description: "5mm 3050 x 1560 mm White P/E Foamalite Xpress Foam PVC (PQ80)",
        sku: "FLXP53015PE",
        unit: "SHEET",
        unitPrice: 41.753,
        thicknessMm: 5,
      },
    ];

    for (const line of lines) {
      const proposal = proposeMaterialFromInvoiceLine(line);

      assert.equal(proposal.purchaseUnit, "sheet");
      assert.equal(proposal.thicknessMm, line.thicknessMm);
      assert.equal(proposal.purchaseWidthMm, 3050);
      assert.equal(proposal.purchaseHeightMm, 1560);
      assert.equal(proposal.purchaseLengthMm, null);
    }

    const multiplied = proposeMaterialFromInvoiceLine({
      description: "10mm 2440 × 1220mm White Foamalite",
      sku: null,
      unit: "sheet",
      unitPrice: 16.15,
    });
    const millimetresFirst = proposeMaterialFromInvoiceLine({
      description: "3mm 1220mm x 2440mm White Foamalite",
      sku: null,
      unit: "sheet",
      unitPrice: 16.15,
    });
    const ambiguous = proposeMaterialFromInvoiceLine({
      description: "3mm 3050x1560mm or 2440x1220mm White Foamalite",
      sku: null,
      unit: "sheet",
      unitPrice: 16.15,
    });
    const kept = proposeMaterialFromInvoiceLine({
      description: lines[0].description,
      sku: lines[0].sku,
      unit: "SHEET",
      unitPrice: lines[0].unitPrice,
      enteredWidthMm: 1000,
      enteredHeightMm: null,
    });

    assert.equal(multiplied.purchaseWidthMm, 2440);
    assert.equal(multiplied.purchaseHeightMm, 1220);
    assert.equal(multiplied.thicknessMm, 10);
    assert.equal(millimetresFirst.purchaseWidthMm, 1220);
    assert.equal(millimetresFirst.purchaseHeightMm, 2440);
    assert.equal(millimetresFirst.thicknessMm, 3);
    assert.equal(ambiguous.purchaseWidthMm, null);
    assert.equal(ambiguous.purchaseHeightMm, null);
    assert.equal(ambiguous.thicknessMm, 3);
    assert.equal(kept.purchaseWidthMm, 1000);
    assert.equal(kept.purchaseHeightMm, null);
    assert.equal(kept.thicknessMm, 3);
  });

  it("reads the Briteline roll from SI1311237 as width and length", () => {
    const proposal = proposeMaterialFromInvoiceLine({
      description:
        "Briteline MT WHT GB Removable 1370mm x 50m Monomeric Vinyl - Grey Adhesive (BLMVMWRG1370)",
      sku: "BLMV137MWRG",
      unit: "Roll",
      unitPrice: 89.11,
    });

    assert.equal(proposal.purchaseUnit, "roll");
    assert.equal(proposal.category, "Vinyl");
    assert.equal(proposal.thicknessMm, null);
    assert.equal(proposal.purchaseWidthMm, 1370);
    assert.equal(proposal.purchaseHeightMm, null);
    assert.equal(proposal.purchaseLengthMm, 50000);
    assert.equal(
      proposeMaterialFromInvoiceLine({
        description:
          "Briteline MT WHT GB Removable 1370mm x 50m Monomeric Vinyl - Grey Adhesive (BLMVMWRG1370)",
        sku: "BLMV137MWRG",
        unit: "Roll",
        unitPrice: 89.11,
        enteredLengthMm: 25000,
      }).purchaseLengthMm,
      25000
    );
  });

  it("creates one opening price in a single function and does not rewrite existing prices or preferences", async () => {
    const sql = await readFile(
      new URL(
        "../../../supabase/migrations/20261001193000_create_material_from_invoice_line.sql",
        import.meta.url
      ),
      "utf8"
    );
    const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION"), sql.indexOf("REVOKE ALL ON FUNCTION"));

    assert.match(fn, /INSERT INTO public\.materials/);
    assert.match(fn, /INSERT INTO public\.material_supplier_products/);
    assert.equal(fn.match(/INSERT INTO public\.material_prices/g)?.length, 1);
    assert.match(fn, /'supplier_invoice'/);
    assert.match(fn, /p_invoice_line_id::text/);
    assert.match(fn, /INSERT INTO public\.supplier_product_description_mappings/);
    assert.match(fn, /review_status = 'processed'/);
    assert.match(fn, /material_created/);
    assert.match(fn, /opening_price_created/);
    assert.match(fn, /invoice_line_resolved/);
    assert.doesNotMatch(fn, /UPDATE public\.material_prices/);
    assert.doesNotMatch(fn, /DELETE FROM public\.material_prices/);
    assert.doesNotMatch(fn, /UPDATE public\.material_supplier_products/);
    assert.doesNotMatch(fn, /set_material_supplier_product_preferred/);
    assert.doesNotMatch(fn, /\bCOMMIT\b/);
    assert.match(fn, /RAISE EXCEPTION 'A material with this name and specification already exists'/);
    assert.match(fn, /RAISE EXCEPTION 'This supplier already has that SKU'/);
    assert.match(fn, /RAISE EXCEPTION 'This invoice line has already created an opening price'/);
    assert.match(sql, /material_prices_supplier_invoice_line_idx/);
  });
});
