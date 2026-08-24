import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildOcgCutPathPdfBuffer } from "@/lib/proof-generator/cut-path-test-pdfs";
import {
  tokenizeContentStream,
  tokenizeContentStreamSafe,
} from "@/lib/proof-generator/content-stream-tokenizer";
import { createCustomerPreviewPdfBuffer } from "@/lib/proof-generator/suppress-cut-path-preview";

/** Regression: standalone `)` previously caused an infinite loop in the old tokenizer. */
const J4_HANG_REGRESSION_STREAM =
  "q 1 0 0 1 0 0 cm ) 0 0 m 100 0 l 100 100 l 0 100 l h S Q";

describe("tokenizeContentStreamSafe", () => {
  it("tokenizes a normal valid content stream", () => {
    const result = tokenizeContentStreamSafe("q 1 0 0 1 0 0 cm Q");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.tokens, ["q", "1", "0", "0", "1", "0", "0", "cm", "Q"]);
    }
  });

  it("terminates on malformed standalone closing delimiter (J-4 regression)", () => {
    const started = Date.now();
    const result = tokenizeContentStreamSafe(J4_HANG_REGRESSION_STREAM);
    assert.ok(Date.now() - started < 500, "tokenizer must not hang");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.tokens.includes("S"));
      assert.ok(result.tokens.length > 0);
    }
  });

  it("preserves literal string operands such as Test labels", () => {
    const result = tokenizeContentStreamSafe("BT /F1 56 Tf 10 20 Td (Test) Tj ET");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.tokens.includes("(Test)"));
      assert.ok(result.tokens.includes("Tj"));
    }
  });

  it("fails safely on unterminated literal string", () => {
    const result = tokenizeContentStreamSafe("q (hello Q");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.reason, /unterminated literal string/);
    }
  });

  it("fails safely on unterminated hex string", () => {
    const result = tokenizeContentStreamSafe("q <deadbeef Q");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.reason, /unterminated hex string/);
    }
  });

  it("fails safely on unexpected nested dictionary overrun", () => {
    const result = tokenizeContentStreamSafe(`q ${"<<".repeat(600_000)} Q`);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.reason, /unterminated dictionary/);
    }
  });

  it("tokenizes nested array content", () => {
    const result = tokenizeContentStreamSafe("q [1 [2 3] 4] Q");
    assert.equal(result.ok, true);
  });

  it("tokenizes name operands", () => {
    const result = tokenizeContentStreamSafe("/CutContour BMC EMC");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.tokens, ["/CutContour", "BMC", "EMC"]);
    }
  });
});

describe("tokenizeContentStream", () => {
  it("throws on unterminated content", () => {
    assert.throws(() => tokenizeContentStream("q (unterminated"), /unterminated literal string/);
  });
});

describe("createCustomerPreviewPdfBuffer tokenizer integration", () => {
  it("terminates on J-4 regression stream via OCG suppression fallback or success", async () => {
    const sourceBuffer = buildOcgCutPathPdfBuffer({ shape: "rectangle" });
    const injected = Buffer.from(
      sourceBuffer
        .toString("latin1")
        .replace(
          "100 100 l S",
          `100 100 l S\nBT (${J4_HANG_REGRESSION_STREAM.replace(/\(/g, "\\(").slice(0, 40)}) Tj ET`
        ),
      "latin1"
    );

    const started = Date.now();
    const result = await createCustomerPreviewPdfBuffer(injected, {
      name: "CutContour",
      sourceType: "optional_content_group",
    });
    assert.ok(Date.now() - started < 10_000, "suppression must not hang");

    assert.ok(
      result.originalCutPathSuppressed === true || result.originalCutPathSuppressed === false
    );
    assert.ok(result.buffer.length > 0);
  });

  it("suppresses normal OCG CutContour content", async () => {
    const sourceBuffer = buildOcgCutPathPdfBuffer({ shape: "rectangle" });
    const result = await createCustomerPreviewPdfBuffer(sourceBuffer, {
      name: "CutContour",
      sourceType: "optional_content_group",
    });

    assert.equal(result.originalCutPathSuppressed, true);
    assert.notEqual(result.suppressionReason, "content stream tokenizer made no progress");
  });
});
