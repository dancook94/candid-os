import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

async function readRepoFile(path: string) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("production board mobile view", () => {
  it("1. mobile production view exists below lg breakpoint", async () => {
    const pageSource = await readRepoFile("app/admin/production/page.tsx");
    const mobileSource = await readRepoFile(
      "components/production/job-production-board-mobile.tsx"
    );

    assert.match(pageSource, /JobProductionBoardMobile/);
    assert.match(pageSource, /lg:hidden/);
    assert.match(mobileSource, /JobProductionBoardMobileCard/);
  });

  it("2. desktop kanban board remains at lg and above", async () => {
    const pageSource = await readRepoFile("app/admin/production/page.tsx");
    const boardSource = await readRepoFile(
      "components/production/job-production-board.tsx"
    );

    assert.match(pageSource, /JobProductionBoard initialData/);
    assert.match(pageSource, /hidden lg:block/);
    assert.match(boardSource, /DndContext/);
    assert.match(boardSource, /JOB_PRODUCTION_BOARD_COLUMNS/);
  });

  it("3. existing stage definitions are reused for mobile chips", async () => {
    const mobileLibSource = await readRepoFile("lib/production/job-board-mobile.ts");

    assert.match(mobileLibSource, /JOB_PRODUCTION_BOARD_STAGES/);
    assert.match(mobileLibSource, /JOB_PRODUCTION_BOARD_STAGE_LABELS/);
    assert.match(mobileLibSource, /value: "all", label: "All"/);
  });

  it("4. mobile list reuses existing production board data shape", async () => {
    const mobileSource = await readRepoFile(
      "components/production/job-production-board-mobile.tsx"
    );
    const mobileLibSource = await readRepoFile("lib/production/job-board-mobile.ts");

    assert.match(mobileSource, /JobProductionBoardData/);
    assert.match(mobileSource, /flattenJobProductionBoardCards/);
    assert.match(mobileLibSource, /JobProductionBoardData/);
  });

  it("5. search and filter state reuse existing production board filters", async () => {
    const pageSource = await readRepoFile("app/admin/production/page.tsx");
    const controlsSource = await readRepoFile(
      "components/production/production-board-mobile-controls.tsx"
    );
    const fieldsSource = await readRepoFile(
      "components/production/production-board-filter-fields.tsx"
    );

    assert.match(pageSource, /ProductionBoardMobileControls/);
    assert.match(pageSource, /ProductionBoardFilterFields/);
    assert.match(controlsSource, /hasActiveProductionBoardFilters/);
    assert.match(controlsSource, /method="get"/);
    assert.match(fieldsSource, /name="search"/);
    assert.match(fieldsSource, /name="company"/);
  });

  it("6. mobile stage selection filters client-side without duplicate fetch", async () => {
    const mobileSource = await readRepoFile(
      "components/production/job-production-board-mobile.tsx"
    );

    assert.match(mobileSource, /useState<MobileProductionBoardStageFilter>/);
    assert.match(mobileSource, /flattenJobProductionBoardCards\(initialData, stageFilter\)/);
    assert.doesNotMatch(mobileSource, /fetch\(/);
  });

  it("7. no duplicate production transition logic on mobile", async () => {
    const mobileCardSource = await readRepoFile(
      "components/production/job-production-board-mobile-card.tsx"
    );
    const mobileSource = await readRepoFile(
      "components/production/job-production-board-mobile.tsx"
    );

    assert.match(mobileCardSource, /href={`\/admin\/jobs\/\$\{card.id\}`}/);
    assert.doesNotMatch(mobileSource, /production-board-stage/);
    assert.doesNotMatch(mobileCardSource, /production-board-stage/);
  });

  it("8. PrintFactory preview architecture is reused on mobile cards", async () => {
    const mobileCardSource = await readRepoFile(
      "components/production/job-production-board-mobile-card.tsx"
    );

    assert.match(mobileCardSource, /ProductionBoardPrintfactoryPreview/);
    assert.match(mobileCardSource, /preview_thumbnail_url/);
    assert.match(mobileCardSource, /preview_output_page_count/);
  });

  it("9. desktop sticky filters are desktop-only to avoid mobile overlap", async () => {
    const pageSource = await readRepoFile("app/admin/production/page.tsx");

    assert.match(pageSource, /hidden lg:block[\s\S]*sticky top-\[4\.5rem\]/);
    assert.match(pageSource, /ProductionBoardMobileControls/);
  });

  it("10. permissions remain enforced at page level", async () => {
    const pageSource = await readRepoFile("app/admin/production/page.tsx");

    assert.match(pageSource, /requireCrmPageAccess/);
    assert.doesNotMatch(pageSource, /production.*role/i);
  });
});
