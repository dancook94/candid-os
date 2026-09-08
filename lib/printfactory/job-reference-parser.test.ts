import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractNumericJobFolderReferencesFromPath,
  extractPrimaryJobReferenceFromPath,
} from "@/lib/printfactory/job-reference-parser";

const REAL_TRANSIT_PATH =
  "//candidserver/candid server/TRANSIT/2026 ORDERS/AUGUST ORDERS/04.08.26/1897pwruno/wetransfer_artwork-files_2026-08-03_1313/Welcome Note/done/Welcome Note A5.pdf";

describe("job-reference-parser legacy server folders", () => {
  it("extracts J-1897 from the real PrintFactory TRANSIT path", () => {
    assert.equal(extractPrimaryJobReferenceFromPath(REAL_TRANSIT_PATH), "J-1897");
    assert.deepEqual(extractNumericJobFolderReferencesFromPath(REAL_TRANSIT_PATH), [
      "J-1897",
    ]);
  });

  it("does not treat years, dates, transfer names, or item labels as job refs", () => {
    const negativePaths = [
      "/TRANSIT/2026 ORDERS/file.pdf",
      "/04.08.26/file.pdf",
      "/wetransfer_artwork-files_2026-08-03_1313/file.pdf",
      "/Item 22 S20 1500x540mm/file.pdf",
    ];

    for (const path of negativePaths) {
      assert.equal(extractPrimaryJobReferenceFromPath(path), null, path);
    }
  });

  it("extracts from numeric server folder variants", () => {
    assert.equal(
      extractPrimaryJobReferenceFromPath(
        "/TRANSIT/2026 ORDERS/AUGUST ORDERS/04.08.26/1897pwruno/file.pdf"
      ),
      "J-1897"
    );
    assert.equal(
      extractPrimaryJobReferenceFromPath("/server/1897 PWR UNO/art/file.pdf"),
      "J-1897"
    );
    assert.equal(
      extractPrimaryJobReferenceFromPath("/server/1897-pwruno/art/file.pdf"),
      "J-1897"
    );
    assert.equal(
      extractPrimaryJobReferenceFromPath("/server/1897_pwruno/art/file.pdf"),
      "J-1897"
    );
    assert.equal(extractPrimaryJobReferenceFromPath("/server/1897/art/file.pdf"), "J-1897");
  });

  it("keeps explicit J-reference matching highest priority", () => {
    assert.equal(
      extractPrimaryJobReferenceFromPath("/Jobs/J-1897 Customer/file.pdf"),
      "J-1897"
    );
    assert.equal(
      extractPrimaryJobReferenceFromPath("/Jobs/J1897 Customer/file.pdf"),
      "J-1897"
    );
  });
});
