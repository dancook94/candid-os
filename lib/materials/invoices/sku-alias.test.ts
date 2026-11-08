import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyInvoiceLine } from "@/lib/materials/invoices/match";
import type { InvoiceMatchProduct } from "@/lib/materials/invoices/model";
import { skuAliasConflictMessage } from "@/lib/materials/invoices/sku-alias";

const product: InvoiceMatchProduct = {
  id: "briteline",
  supplierId: "pyramid",
  sku: "BLMVMWRG1370",
  description: "Briteline MT WHT GB Removable",
  materialName: "Briteline Greyback Removable 1370mm x 50m",
  purchaseUnit: "roll",
  thicknessMm: null,
  colour: null,
  widthMm: 1370,
  heightMm: null,
  lengthMm: 50000,
  currentPrice: 89.11,
  currentPriceUnit: "roll",
};

describe("supplier SKU aliases", () => {
  it("matches invoice lines through a confirmed alias without changing the canonical SKU", () => {
    const classified = classifyInvoiceLine({
      line: {
        lineNumber: 1,
        rawDescription: "Briteline Greyback 1370mm x 50m",
        rawSupplierSku: "BLMV137MWPC",
        rawQuantity: 1,
        rawUnit: "roll",
        rawUnitPrice: 89.1,
        rawLineTotal: 89.1,
        rawTax: null,
      },
      supplierId: "pyramid",
      products: [product],
      mappings: [],
      skuAliases: [{ supplierId: "pyramid", productId: "briteline", sku: "BLMV137MWPC" }],
      ignoreRules: [],
    });

    assert.equal(classified.matchedProductId, "briteline");
    assert.equal(classified.matchMethod, "sku");
    assert.equal(product.sku, "BLMVMWRG1370");
  });

  it("refuses to reuse the canonical SKU as an alias", () => {
    const message = skuAliasConflictMessage({
      invoiceSku: "BLMVMWRG1370",
      canonicalSku: "BLMVMWRG1370",
    });

    assert.match(message ?? "", /canonical supplier SKU/);
  });
});
