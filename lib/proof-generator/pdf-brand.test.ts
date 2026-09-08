import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";

import { embedCandidLogo } from "@/lib/proof-generator/pdf-layout";
import {
  PROOF_PDF_LOGO_DISPLAY_WIDTH,
  PROOF_PDF_LOGO_PATH,
  loadCandidLogoPng,
} from "@/lib/proof-generator/pdf-brand";

describe("pdf-brand logo loading", () => {
  it("reads LOGO_YELLOW.png bytes directly from disk", async () => {
    const logoBytes = await loadCandidLogoPng();
    const fileBytes = await readFile(PROOF_PDF_LOGO_PATH);

    assert.equal(logoBytes.length, fileBytes.length);
    assert.equal(logoBytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  });

  it("embeds the logo with pdf-lib while preserving display width and aspect ratio", async () => {
    const doc = await PDFDocument.create();
    const logo = await embedCandidLogo(doc);
    const sourceAspect = logo.image.width / logo.image.height;

    assert.equal(logo.width, PROOF_PDF_LOGO_DISPLAY_WIDTH);
    assert.equal(logo.height, logo.width / sourceAspect);
    assert.ok(logo.image.width > logo.width);
    assert.ok(logo.rasterWidth === logo.image.width);
  });
});
