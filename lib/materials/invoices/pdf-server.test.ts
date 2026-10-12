import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import Module from "node:module";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PDFDocument, StandardFonts } from "pdf-lib";

const nodeRequire = createRequire(import.meta.url);
const originalRequire = Module.prototype.require;

test("PDF text extraction works when only the traced canvas geometry file is present", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "canvas-geometry-"));
  const packageDir = path.join(root, "node_modules", "@napi-rs", "canvas");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify({ name: "@napi-rs/canvas", main: "index.js" })
  );
  copyFileSync(
    nodeRequire.resolve("@napi-rs/canvas/geometry.js"),
    path.join(packageDir, "geometry.js")
  );

  Module.prototype.require = function (id: string, ...args: unknown[]) {
    if (id === "@napi-rs/canvas") {
      return originalRequire.call(this, packageDir);
    }

    if (id === "@napi-rs/canvas/geometry.js") {
      return originalRequire.call(this, path.join(packageDir, "geometry.js"));
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
    rmSync(root, { recursive: true, force: true });
  }
});
