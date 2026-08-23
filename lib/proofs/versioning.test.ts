import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCustomerProofPdfFileName } from "@/lib/proofs/dropbox";
import {
  buildProofReference,
  canCreateRevisedProof,
  formatProofHistoryEntry,
  getCurrentProofInLineage,
  getCurrentProofRecord,
  groupProofsByLineage,
  hasInProgressProof,
  highestProofVersionInLineage,
  manifestItemSetsMatch,
  nextProofVersionInLineage,
  proofSupportsRevision,
} from "@/lib/proofs/versioning";

describe("manifestItemSetsMatch", () => {
  it("matches identical manifest item sets regardless of order", () => {
    assert.equal(manifestItemSetsMatch(["b", "a"], ["a", "b"]), true);
    assert.equal(manifestItemSetsMatch(["a"], ["a", "b"]), false);
  });
});

describe("nextProofVersionInLineage", () => {
  it("increments within one proof lineage only", () => {
    const proofs = [
      { proof_lineage_id: "lineage-a", version_number: 1 },
      { proof_lineage_id: "lineage-a", version_number: 2 },
      { proof_lineage_id: "lineage-b", version_number: 1 },
    ];

    assert.equal(nextProofVersionInLineage(proofs, "lineage-a"), 3);
    assert.equal(nextProofVersionInLineage(proofs, "lineage-b"), 2);
    assert.equal(nextProofVersionInLineage(proofs, "lineage-c"), 1);
  });
});

describe("groupProofsByLineage", () => {
  it("groups and sorts versions within each lineage", () => {
    const groups = groupProofsByLineage([
      {
        proof_lineage_id: "a",
        version_number: 1,
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        proof_lineage_id: "a",
        version_number: 2,
        created_at: "2026-01-02T00:00:00.000Z",
      },
      {
        proof_lineage_id: "b",
        version_number: 1,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);

    assert.equal(groups.length, 2);
    assert.deepEqual(
      groups[0].map((proof) => proof.version_number),
      [2, 1]
    );
  });
});

describe("proofSupportsRevision", () => {
  it("allows revision from generated draft versions", () => {
    assert.equal(
      proofSupportsRevision({ status: "draft", brandedPdfGeneratedAt: "2026-01-01" }),
      true
    );
    assert.equal(proofSupportsRevision({ status: "draft", brandedPdfGeneratedAt: null }), false);
  });
});

describe("buildCustomerProofPdfFileName", () => {
  it("uses item reference for single-item proofs", () => {
    assert.equal(
      buildCustomerProofPdfFileName({
        versionNumber: 2,
        itemReference: "J-4-01",
        jobReference: "J-4",
      }),
      "J-4-01-Proof-v2.pdf"
    );
  });

  it("uses job reference for multi-item proofs", () => {
    assert.equal(
      buildCustomerProofPdfFileName({
        versionNumber: 3,
        jobReference: "J-4",
      }),
      "J-4-Proof-v3.pdf"
    );
  });
});

describe("buildProofReference", () => {
  it("builds a stable proof reference from job reference and version", () => {
    assert.equal(buildProofReference("J-4", 2), "J-4 Proof v2");
  });
});

describe("getCurrentProofRecord", () => {
  it("returns the highest non-archived version", () => {
    const current = getCurrentProofRecord([
      {
        status: "changes_requested",
        version_number: 1,
        proof_lineage_id: "a",
      },
      {
        status: "draft",
        version_number: 2,
        proof_lineage_id: "a",
      },
      {
        status: "superseded",
        version_number: 1,
        proof_lineage_id: "b",
      },
    ]);

    assert.equal(current?.version_number, 2);
  });
});

describe("getCurrentProofInLineage", () => {
  it("returns the latest active version within one lineage", () => {
    const current = getCurrentProofInLineage([
      { status: "superseded", version_number: 1 },
      { status: "draft", version_number: 2 },
    ]);

    assert.equal(current?.version_number, 2);
  });
});

describe("canCreateRevisedProof", () => {
  it("allows revision when source is changes_requested and nothing is in progress in the lineage", () => {
    assert.equal(
      canCreateRevisedProof(
        {
          status: "changes_requested",
          proof_lineage_id: "lineage-a",
          version_number: 1,
          brandedPdfGeneratedAt: "2026-01-01",
        },
        [
          {
            id: "1",
            status: "changes_requested",
            version_number: 1,
            proof_lineage_id: "lineage-a",
          },
        ]
      ),
      true
    );
  });

  it("blocks revision while another version is in progress in the same lineage", () => {
    assert.equal(
      canCreateRevisedProof(
        {
          status: "changes_requested",
          proof_lineage_id: "lineage-a",
          version_number: 1,
          brandedPdfGeneratedAt: "2026-01-01",
        },
        [
          {
            id: "1",
            status: "changes_requested",
            version_number: 1,
            proof_lineage_id: "lineage-a",
          },
          {
            id: "2",
            status: "draft",
            version_number: 2,
            proof_lineage_id: "lineage-a",
          },
        ]
      ),
      false
    );
  });
});

describe("hasInProgressProof", () => {
  it("detects draft proofs", () => {
    assert.equal(hasInProgressProof([{ status: "draft" }]), true);
    assert.equal(hasInProgressProof([{ status: "approved" }]), false);
  });
});

describe("formatProofHistoryEntry", () => {
  it("formats title, version and status", () => {
    assert.equal(
      formatProofHistoryEntry(
        { title: "Foamex Panels", version_number: 1, status: "changes_requested" },
        "Changes requested"
      ),
      "Foamex Panels · v1 — Changes requested"
    );
  });
});

describe("highestProofVersionInLineage", () => {
  it("returns the max version within one lineage", () => {
    assert.equal(
      highestProofVersionInLineage(
        [
          { proof_lineage_id: "a", version_number: 1 },
          { proof_lineage_id: "a", version_number: 3 },
          { proof_lineage_id: "b", version_number: 2 },
        ],
        "a"
      ),
      3
    );
  });
});
