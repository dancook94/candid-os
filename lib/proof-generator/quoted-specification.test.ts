import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertValidSourceArtworkBuffer,
  detectArtworkBufferKind,
} from "@/lib/proof-generator/artwork-buffer";
import { parseDimensionsFromText } from "@/lib/proof-generator/quoted-specification";

const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

describe("parseDimensionsFromText", () => {
  it("parses plain finished sizes", () => {
    assert.deepEqual(parseDimensionsFromText("1200 x 800mm"), {
      widthMm: 1200,
      heightMm: 800,
    });
  });

  it("parses labelled dimensions in descriptions", () => {
    assert.deepEqual(parseDimensionsFromText("Finished size: 1200mm x 800mm"), {
      widthMm: 1200,
      heightMm: 800,
    });
  });
});

describe("assertValidSourceArtworkBuffer", () => {
  it("accepts png artwork buffers", () => {
    assert.equal(assertValidSourceArtworkBuffer(MINIMAL_PNG, "artwork.png"), "png");
  });

  it("rejects html login pages masquerading as artwork", () => {
    const html = Buffer.from("<!DOCTYPE html><html><body>Candid OS login</body></html>", "utf8");
    assert.throws(
      () => assertValidSourceArtworkBuffer(html, "artwork.png"),
      /web page instead of a PDF or image/
    );
  });
});

describe("detectArtworkBufferKind", () => {
  it("detects png buffers", () => {
    assert.equal(detectArtworkBufferKind(MINIMAL_PNG), "png");
  });
});
