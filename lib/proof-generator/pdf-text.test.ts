import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatPdfDimensionsLabel,
  formatPreflightCheckLine,
  formatProofFieldValue,
  PDF_NOT_SPECIFIED,
  sanitizePdfText,
  statusPrefixForCheck,
} from "@/lib/proof-generator/pdf-text";

describe("sanitizePdfText", () => {
  it("converts smart apostrophes in customer names", () => {
    assert.equal(sanitizePdfText("O'Brien Signs"), "O'Brien Signs");
    assert.equal(sanitizePdfText("O\u2019Brien Signs"), "O'Brien Signs");
  });

  it("converts smart quotes and dashes", () => {
    assert.equal(
      sanitizePdfText("\u201CProof\u201D \u2014 approved"),
      '"Proof" - approved'
    );
  });

  it("converts multiplication and middle dot dimensions", () => {
    assert.equal(sanitizePdfText("1200 \u00D7 800mm"), "1200 x 800mm");
    assert.equal(sanitizePdfText("Item A \u00B7 Item B"), "Item A  |  Item B");
  });

  it("replaces unsupported symbols with ASCII fallbacks", () => {
    assert.equal(sanitizePdfText("\u26A0 RGB content detected"), "WARNING RGB content detected");
    assert.equal(sanitizePdfText("\u2713 Size matches"), "PASS Size matches");
    assert.equal(sanitizePdfText("Step 1 \u2192 Step 2"), "Step 1 -> Step 2");
    assert.equal(sanitizePdfText("\u2022 Bullet item"), "- Bullet item");
  });
});

describe("statusPrefixForCheck", () => {
  it("uses ASCII status prefixes for preflight lines", () => {
    assert.equal(statusPrefixForCheck("pass"), "PASS");
    assert.equal(statusPrefixForCheck("warning"), "WARNING");
    assert.equal(statusPrefixForCheck("manual_review"), "REVIEW");
    assert.equal(statusPrefixForCheck("fail"), "FAIL");
  });
});

describe("formatPreflightCheckLine", () => {
  it("formats warning and pass lines for PDF output", () => {
    assert.equal(
      formatPreflightCheckLine({
        status: "warning",
        label: "Colour mode",
        message: "RGB content detected",
      }),
      "WARNING - Colour mode: RGB content detected"
    );

    assert.equal(
      formatPreflightCheckLine({
        status: "pass",
        label: "Size / scale",
        message: "Artwork dimensions match quoted specification",
      }),
      "PASS - Size / scale: Artwork dimensions match quoted specification"
    );
  });
});

describe("formatPdfDimensionsLabel", () => {
  it("uses x instead of multiplication sign", () => {
    assert.equal(formatPdfDimensionsLabel(1200, 800), "1200 x 800 mm");
  });

  it("returns Not specified when dimensions are missing", () => {
    assert.equal(formatPdfDimensionsLabel(null, 800), PDF_NOT_SPECIFIED);
  });
});

describe("formatProofFieldValue", () => {
  it("returns Not specified for empty values", () => {
    assert.equal(formatProofFieldValue(null), PDF_NOT_SPECIFIED);
    assert.equal(formatProofFieldValue("  "), PDF_NOT_SPECIFIED);
  });
});
