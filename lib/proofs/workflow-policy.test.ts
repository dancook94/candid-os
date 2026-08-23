import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canCreateRevision,
  canEditProofAttachment,
  hasBlockingRevisionInLineage,
} from "@/lib/proofs/workflow-policy";

describe("canCreateRevision", () => {
  it("offers revision for ready_to_send current proof without generated file metadata", () => {
    assert.equal(
      canCreateRevision(
        {
          id: "1",
          status: "ready_to_send",
          proof_lineage_id: "lineage-a",
          version_number: 7,
          brandedPdfGeneratedAt: null,
          files: [],
        },
        [
          {
            id: "1",
            status: "ready_to_send",
            proof_lineage_id: "lineage-a",
            version_number: 7,
          },
        ]
      ),
      true
    );
  });

  it("blocks revision when a newer draft exists in the lineage", () => {
    assert.equal(
      canCreateRevision(
        {
          id: "1",
          status: "ready_to_send",
          proof_lineage_id: "lineage-a",
          version_number: 7,
          brandedPdfGeneratedAt: "2026-01-01",
          files: [],
        },
        [
          {
            id: "1",
            status: "ready_to_send",
            proof_lineage_id: "lineage-a",
            version_number: 7,
          },
          {
            id: "2",
            status: "draft",
            proof_lineage_id: "lineage-a",
            version_number: 8,
          },
        ]
      ),
      false
    );
  });

  it("does not treat ready_to_send alone as a blocking in-progress revision", () => {
    assert.equal(
      hasBlockingRevisionInLineage(
        [
          {
            id: "1",
            status: "ready_to_send",
            proof_lineage_id: "lineage-a",
            version_number: 7,
          },
        ],
        { id: "1", version_number: 7 }
      ),
      false
    );
  });
});

describe("canEditProofAttachment", () => {
  it("blocks attachment edits once a generated customer proof exists", () => {
    assert.equal(
      canEditProofAttachment({
        status: "draft",
        brandedPdfGeneratedAt: "2026-01-01",
        files: [{ file_role: "customer_proof", dropbox_path: "/proof.pdf" } as never],
      }),
      false
    );
  });

  it("allows attachment edits on draft proofs without generated PDFs", () => {
    assert.equal(
      canEditProofAttachment({
        status: "draft",
        brandedPdfGeneratedAt: null,
        files: [{ file_role: "source_artwork", dropbox_path: "/art.pdf" } as never],
      }),
      true
    );
  });
});
