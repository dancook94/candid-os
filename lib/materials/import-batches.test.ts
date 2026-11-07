import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  applyBatchImportGuards,
  parseApprovedImportCatalogVersion,
} from "@/lib/materials/import-batches";
import {
  INITIAL_IMPORT_CATALOG_VERSION,
  INITIAL_IMPORT_CONFIRMATION,
} from "@/lib/materials/initial-import-catalog";
import { buildInitialImportPlan } from "@/lib/materials/initial-import-plan";
import {
  MEDIUM_IMPORT_CATALOG_VERSION,
  mediumImportSource,
} from "@/lib/materials/medium-import-catalog";

describe("approved import batches", () => {
  it("accepts only the two approved catalogue versions", () => {
    assert.equal(
      parseApprovedImportCatalogVersion("initial-approved-46"),
      INITIAL_IMPORT_CATALOG_VERSION
    );
    assert.equal(
      parseApprovedImportCatalogVersion("medium-approved-batch-2"),
      MEDIUM_IMPORT_CATALOG_VERSION
    );
    assert.equal(parseApprovedImportCatalogVersion("other"), null);
    assert.equal(parseApprovedImportCatalogVersion(null), null);
  });

  it("blocks batch 2 commit until batch 1 is recorded", () => {
    const clearedPlan = {
      catalogVersion: MEDIUM_IMPORT_CATALOG_VERSION,
      effectiveDate: "2026-10-01",
      canCommit: true,
      blockedReason: null,
      aliasesReady: true,
      suppliers: [],
      aliases: [],
      materials: [],
      preserved: [],
      skipped: [],
      counts: {
        suppliersToCreate: 0,
        suppliersMatched: 0,
        aliasesToCreate: 0,
        aliasesMatched: 0,
        materialsToCreate: 0,
        productsToCreate: 0,
        pricesToCreate: 0,
        alreadyMatched: 0,
        conflicts: 0,
      },
      warnings: [],
      errors: [],
    };

    const blocked = applyBatchImportGuards(clearedPlan, {
      runsReady: true,
      completedCatalogVersions: [],
    });

    assert.equal(blocked.canCommit, false);
    assert.match(blocked.blockedReason ?? "", /Batch 1/);

    const allowed = applyBatchImportGuards(clearedPlan, {
      runsReady: true,
      completedCatalogVersions: [INITIAL_IMPORT_CATALOG_VERSION],
    });

    assert.equal(allowed.importStatus?.batch1Completed, true);
    assert.equal(allowed.canCommit, true);
  });

  it("still blocks a conflicted medium plan when batch 1 is missing", () => {
    const emptySnapshot = {
      aliasesReady: true,
      suppliers: [],
      aliases: [],
      materials: [],
      products: [],
      prices: [],
    };
    const plan = buildInitialImportPlan(
      emptySnapshot,
      "2026-10-01",
      mediumImportSource()
    );

    const blocked = applyBatchImportGuards(plan, {
      runsReady: true,
      completedCatalogVersions: [],
    });

    assert.equal(blocked.canCommit, false);
  });

  it("requires the shared confirmation phrase for RPC commits", () => {
    assert.equal(INITIAL_IMPORT_CONFIRMATION, "IMPORT APPROVED MATERIALS");
  });

  it("keeps preview read-only at the API and server layer", async () => {
    const route = await readFile(
      new URL("../../app/api/admin/materials/initial-import/route.ts", import.meta.url),
      "utf8"
    );
    const action = await readFile(new URL("./initial-import.ts", import.meta.url), "utf8");

    assert.match(route, /previewInitialMaterialImport/);
    assert.match(route, /parseApprovedImportCatalogVersion/);
    assert.doesNotMatch(route, /\.rpc\(/);

    const previewBlock = action.match(
      /export async function previewInitialMaterialImport\([\s\S]*?\n\}\n\nfunction commitError/
    );
    assert.ok(previewBlock);
    assert.doesNotMatch(previewBlock[0], /\.rpc\(/);
    assert.match(action, /commitInitialMaterialImport[\s\S]*apply_initial_materials_import/);
  });
});
