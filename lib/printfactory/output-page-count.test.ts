import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  mergeRippedOutputPageCountIntoMetadata,
  parseRippedOutputPageCountFromParsedJob,
  parseRippedOutputPageCountFromXml,
  readRippedOutputPageCountFromMetadata,
  resolveDisplayOutputPageCount,
} from "@/lib/printfactory/output-page-count";

async function readFixture(name: string) {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

describe("parseRippedOutputPageCountFromXml", () => {
  it("counts 3 Statistics/Page nodes with numbers 1, 2, 3", async () => {
    const xml = await readFixture("rolex-2-detail.xml");
    const result = parseRippedOutputPageCountFromXml(xml);

    assert.ok(result);
    assert.equal(result.rippedOutputPageCount, 3);
    assert.deepEqual(result.rippedOutputPageNumbers, [1, 2, 3]);
    assert.equal(result.rippedOutputPageCountSource, "statistics");
  });

  it("falls back to job-level Pages when Statistics/Page is absent", () => {
    const result = parseRippedOutputPageCountFromParsedJob({
      Pages: "2",
      Documents: {
        Document: [
          { Name: "a.pdf", Pages: { Page: [{ "@_Number": "0" }, { "@_Number": "0" }] } },
          { Name: "b.pdf", Pages: { Page: { "@_Number": "0" } } },
        ],
      },
    });

    assert.ok(result);
    assert.equal(result.rippedOutputPageCount, 2);
    assert.deepEqual(result.rippedOutputPageNumbers, [1, 2]);
    assert.equal(result.rippedOutputPageCountSource, "job_pages");
  });

  it("ignores Documents.length and document page counts", async () => {
    const xml = await readFixture("rolex-2-detail.xml");
    const result = parseRippedOutputPageCountFromXml(xml);

    assert.ok(result);
    assert.notEqual(result.rippedOutputPageCount, 6);
    assert.equal(result.rippedOutputPageCount, 3);
  });

  it("returns single-sheet count for one Statistics/Page node", () => {
    const result = parseRippedOutputPageCountFromParsedJob({
      Statistics: {
        Page: { "@_Number": "1" },
      },
    });

    assert.ok(result);
    assert.equal(result.rippedOutputPageCount, 1);
    assert.deepEqual(result.rippedOutputPageNumbers, [1]);
  });

  it("returns null for invalid or zero page counts", () => {
    assert.equal(parseRippedOutputPageCountFromParsedJob({ Pages: "0" }), null);
    assert.equal(parseRippedOutputPageCountFromParsedJob({ Statistics: { Page: [] } }), null);
    assert.equal(parseRippedOutputPageCountFromParsedJob(null), null);
  });
});

describe("raw metadata helpers", () => {
  it("reads and resolves stored output page counts", () => {
    const metadata = mergeRippedOutputPageCountIntoMetadata(
      { JobName: "ROLEX 2" },
      {
        rippedOutputPageCount: 3,
        rippedOutputPageNumbers: [1, 2, 3],
        rippedOutputPageCountSource: "statistics",
      }
    );

    assert.equal(readRippedOutputPageCountFromMetadata(metadata), 3);
    assert.equal(resolveDisplayOutputPageCount(metadata, 1), 3);
    assert.equal(metadata.JobName, "ROLEX 2");
  });
});
