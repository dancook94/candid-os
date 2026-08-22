import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCustomerProofPdfFileName } from "@/lib/proofs/dropbox";
import {
  buildProofReference,
  canCreateRevisedProof,
  formatProofHistoryEntry,
  getCurrentProofRecord,
  hasInProgressProof,
} from "@/lib/proofs/versioning";

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
      { status: "changes_requested", version_number: 1 },
      { status: "draft", version_number: 2 },
      { status: "superseded", version_number: 1 },
    ]);

    assert.equal(current?.version_number, 2);
  });
});

describe("canCreateRevisedProof", () => {
  it("allows revision when source is changes_requested and nothing is in progress", () => {
    assert.equal(
      canCreateRevisedProof(
        { status: "changes_requested" },
        [{ id: "1", status: "changes_requested", version_number: 1 }]
      ),
      true
    );
  });

  it("blocks revision while another proof is in progress", () => {
    assert.equal(
      canCreateRevisedProof(
        { status: "changes_requested" },
        [
          { id: "1", status: "changes_requested", version_number: 1 },
          { id: "2", status: "draft", version_number: 2 },
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
