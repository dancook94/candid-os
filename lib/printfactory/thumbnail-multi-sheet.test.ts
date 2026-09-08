import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { PRINTFACTORY_THUMBNAIL_MAX_PAGE } from "@/lib/printfactory/output-page-count";
import { validatePrintfactoryThumbnailPage } from "@/lib/printfactory/thumbnail";

describe("validatePrintfactoryThumbnailPage", () => {
  it("defaults missing page to 1", () => {
    const result = validatePrintfactoryThumbnailPage(null);
    assert.equal(result.ok, true);

    if (result.ok) {
      assert.equal(result.page, 1);
    }
  });

  it("rejects page 0", () => {
    const result = validatePrintfactoryThumbnailPage(0);
    assert.equal(result.ok, false);

    if (!result.ok) {
      assert.equal(result.reason, "below_min");
    }
  });

  it("rejects pages above the configured max", () => {
    const result = validatePrintfactoryThumbnailPage(PRINTFACTORY_THUMBNAIL_MAX_PAGE + 1);
    assert.equal(result.ok, false);

    if (!result.ok) {
      assert.equal(result.reason, "above_max");
    }
  });

  it("accepts valid page numbers within range", () => {
    const result = validatePrintfactoryThumbnailPage("3");
    assert.equal(result.ok, true);

    if (result.ok) {
      assert.equal(result.page, 3);
    }
  });
});

describe("PrintfactoryThumbnailStrip UI contract", () => {
  it("renders three inline thumbnails for a 3-sheet job", async () => {
    const source = await readFile(
      new URL("../../components/production/printfactory-thumbnail-strip.tsx", import.meta.url),
      "utf8"
    );

    assert.match(source, /PrintfactoryThumbnailStrip/);
    assert.match(source, /inlinePages\.map/);
    assert.match(source, /outputPageCount <= 1/);
    assert.match(source, /\+\{hiddenCount\} more/);
    assert.match(source, /Sheet \{currentPage\} of \{outputPageCount\}/);
  });

  it("shows a +N more affordance when inline max is exceeded", async () => {
    const source = await readFile(
      new URL("../../components/production/printfactory-thumbnail-strip.tsx", import.meta.url),
      "utf8"
    );

    assert.match(source, /PRINTFACTORY_THUMBNAIL_INLINE_MAX/);
    assert.match(source, /hiddenCount > 0/);
  });

  it("keeps single-page jobs on the existing single-image path", async () => {
    const source = await readFile(
      new URL("../../components/production/printfactory-thumbnail-strip.tsx", import.meta.url),
      "utf8"
    );

    assert.match(source, /PrintfactoryThumbnailImage/);
    assert.match(source, /outputPageCount <= 1/);
  });
});

describe("Production Board preview contract", () => {
  it("keeps one image and adds a sheet-count badge for multi-sheet jobs", async () => {
    const cardSource = await readFile(
      new URL("../../components/production/job-production-board-card.tsx", import.meta.url),
      "utf8"
    );
    const previewSource = await readFile(
      new URL(
        "../../components/production/production-board-printfactory-preview.tsx",
        import.meta.url
      ),
      "utf8"
    );
    const serviceSource = await readFile(
      new URL("../../lib/production/job-board-service.ts", import.meta.url),
      "utf8"
    );

    assert.match(cardSource, /ProductionBoardPrintfactoryPreview/);
    assert.match(previewSource, /PrintfactoryThumbnailImage/);
    assert.match(previewSource, /\{outputPageCount\} sheets/);
    assert.match(previewSource, /PrintfactoryThumbnailCarousel/);
    assert.match(serviceSource, /preview_output_page_count/);
    assert.match(serviceSource, /preview_printfactory_job_guid/);
  });
});
