import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { invoiceCatalogDescription, invoiceServiceNotes } from "@/lib/materials/invoices/description";

describe("invoice catalogue descriptions", () => {
  it("removes slitting and stock notes but keeps the base product text", () => {
    const raw =
      "SU3-70 KLEENTEAR APPLICATION TAPE 50M X 406MM SLIT TO 3 @ 406MM";

    assert.equal(
      invoiceCatalogDescription(raw),
      "SU3-70 KLEENTEAR APPLICATION TAPE 50M X 406MM"
    );
    assert.match(invoiceServiceNotes(raw) ?? "", /SLIT TO 3 @ 406MM/i);
    assert.doesNotMatch(invoiceCatalogDescription(raw), /PerfectTear/i);
  });
});
