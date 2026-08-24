import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PDFDocument, StandardFonts } from "pdf-lib";

import { validateGeneratedProofPdf } from "@/lib/proof-generator/validate-proof-pdf";

describe("validateGeneratedProofPdf", () => {
  it("accepts a minimal valid PDF", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([595, 842]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText("Proof validation test", { x: 50, y: 800, size: 12, font });
    const buffer = Buffer.from(await document.save());

    const result = await validateGeneratedProofPdf(buffer);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.pageCount, 1);
    }
  });

  it("rejects invalid PDF bytes", async () => {
    const result = await validateGeneratedProofPdf(Buffer.from("not a pdf"));
    assert.equal(result.ok, false);
  });
});
