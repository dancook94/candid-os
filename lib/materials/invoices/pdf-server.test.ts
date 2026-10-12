import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

import { PDFDocument, StandardFonts } from "pdf-lib";

const originalRequire = Module.prototype.require;

test("server PDF extraction loads when pdfjs cannot require the canvas package", async () => {
  Module.prototype.require = function (id: string, ...args: unknown[]) {
    if (id === "@napi-rs/canvas") {
      throw new Error("canvas unavailable to pdfjs");
    }

    return originalRequire.apply(this, [id, ...args]);
  };

  try {
    const { extractPdfText } = await import("@/lib/materials/invoices/extract");
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([600, 800]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("Supplier: Pyramid Display Materials", { x: 40, y: 760, size: 12, font });
    const text = await extractPdfText(await pdf.save());

    assert.equal(typeof globalThis.DOMMatrix, "function");
    assert.match(text, /Pyramid Display Materials/);
  } finally {
    Module.prototype.require = originalRequire;
  }
});
