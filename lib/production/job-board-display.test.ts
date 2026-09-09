import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { formatPrintFactoryLinkedJobsLabel } from "@/lib/production/job-board-display";

async function readRepoFile(path: string) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("formatPrintFactoryLinkedJobsLabel", () => {
  it("returns null when no PrintFactory jobs are linked", () => {
    assert.equal(formatPrintFactoryLinkedJobsLabel(0), null);
  });

  it("uses singular wording for one linked job", () => {
    assert.equal(formatPrintFactoryLinkedJobsLabel(1), "PrintFactory: 1 job linked");
  });

  it("uses plural wording for multiple linked jobs", () => {
    assert.equal(formatPrintFactoryLinkedJobsLabel(4), "PrintFactory: 4 jobs linked");
  });
});

describe("production board card display", () => {
  it("keeps production readiness unchanged and removes ripped from desktop cards", async () => {
    const cardSource = await readRepoFile(
      "components/production/job-production-board-card.tsx"
    );

    assert.match(cardSource, /Production readiness: \{card\.readiness_label\}/);
    assert.doesNotMatch(cardSource, /Ripped:/);
    assert.doesNotMatch(cardSource, /PrintFactory files:/);
    assert.match(cardSource, /formatPrintFactoryLinkedJobsLabel/);
  });

  it("shows PrintFactory linked job counts on mobile cards without ripped", async () => {
    const mobileCardSource = await readRepoFile(
      "components/production/job-production-board-mobile-card.tsx"
    );

    assert.match(mobileCardSource, /Production readiness: \{card\.readiness_label\}/);
    assert.match(mobileCardSource, /formatPrintFactoryLinkedJobsLabel/);
    assert.doesNotMatch(mobileCardSource, /Ripped:/);
    assert.doesNotMatch(mobileCardSource, /PrintFactory files:/);
  });

  it("preserves existing production board drag-and-drop behaviour", async () => {
    const boardSource = await readRepoFile("components/production/job-production-board.tsx");

    assert.match(boardSource, /DndContext/);
    assert.match(boardSource, /production-board-stage/);
    assert.match(boardSource, /handleDeadlineUpdated/);
  });
});
