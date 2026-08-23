import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCutPathTestPdfBuffer,
  buildOcgCutPathPdfBuffer,
} from "@/lib/proof-generator/cut-path-test-pdfs";
import { createCustomerPreviewPdfBuffer } from "@/lib/proof-generator/suppress-cut-path-preview";

describe("createCustomerPreviewPdfBuffer", () => {
  it("suppresses OCG CutContour content from preview copy", () => {
    const sourceBuffer = buildOcgCutPathPdfBuffer({ shape: "rectangle" });
    const result = createCustomerPreviewPdfBuffer(sourceBuffer, {
      name: "CutContour",
      sourceType: "optional_content_group",
    });

    assert.equal(result.originalCutPathSuppressed, true);
    assert.equal(result.method, "ocg_content_filter");
    assert.notEqual(result.buffer.toString("latin1"), sourceBuffer.toString("latin1"));
  });

  it("suppresses separation CutContour strokes from preview copy", () => {
    const sourceBuffer = buildCutPathTestPdfBuffer({ shape: "rectangle" });
    const result = createCustomerPreviewPdfBuffer(sourceBuffer, {
      name: "CutContour",
      sourceType: "separation",
    });

    assert.equal(result.originalCutPathSuppressed, true);
    assert.equal(result.method, "separation_content_filter");
  });

  it("does not suppress when cut path is not confirmed", () => {
    const sourceBuffer = buildCutPathTestPdfBuffer({ shape: "rectangle" });
    const result = createCustomerPreviewPdfBuffer(sourceBuffer, null);

    assert.equal(result.originalCutPathSuppressed, false);
    assert.equal(result.method, "none");
    assert.equal(result.buffer, sourceBuffer);
  });

  it("falls back safely for unsupported source types", () => {
    const sourceBuffer = buildCutPathTestPdfBuffer({ shape: "rectangle" });
    const result = createCustomerPreviewPdfBuffer(sourceBuffer, {
      name: "CutContour",
      sourceType: "layer",
    });

    assert.equal(result.originalCutPathSuppressed, false);
    assert.equal(result.method, "unsupported_source");
  });
});
