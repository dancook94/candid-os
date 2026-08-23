import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canCreateRevision,
  canEditProofAttachment,
  getProofActions,
  hasBlockingRevisionInLineage,
} from "@/lib/proofs/workflow-policy";

describe("getProofActions", () => {
  it("shows create revision on the current ready_to_send card", () => {
    const proof = {
      id: "1",
      status: "ready_to_send" as const,
      proof_lineage_id: "lineage-a",
      version_number: 7,
      brandedPdfGeneratedAt: null,
      files: [],
      created_at: "2026-01-02",
    };

    const actions = getProofActions(proof, [proof], {
      lineageProofs: [proof],
      assumeCurrentInLineage: true,
    });

    assert.equal(actions.canCreateRevision, true);
    assert.equal(actions.canEditAttachment, false);
    assert.match(actions.revisionHelpText ?? "", /Creates v8/);
  });

  it("blocks attachment edits once a proof is ready_to_send", () => {
    assert.equal(
      canEditProofAttachment({
        status: "ready_to_send",
        brandedPdfGeneratedAt: null,
        files: [{ file_role: "source_artwork", dropbox_path: "/art.pdf" } as never],
      }),
      false
    );
  });
});

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
            created_at: "2026-01-02",
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
            created_at: "2026-01-02",
          },
          {
            id: "2",
            status: "draft",
            proof_lineage_id: "lineage-a",
            version_number: 8,
            created_at: "2026-01-03",
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
            created_at: "2026-01-02",
          },
        ],
        { id: "1", version_number: 7 }
      ),
      false
    );
  });

  it("ignores cancelled drafts when checking for blocking revisions", () => {
    assert.equal(
      hasBlockingRevisionInLineage(
        [
          {
            id: "1",
            status: "ready_to_send",
            proof_lineage_id: "lineage-a",
            version_number: 7,
            created_at: "2026-01-02",
          },
          {
            id: "2",
            status: "draft",
            proof_lineage_id: "lineage-a",
            version_number: 8,
            created_at: "2026-01-03",
          },
          {
            id: "3",
            status: "cancelled",
            proof_lineage_id: "lineage-a",
            version_number: 9,
            created_at: "2026-01-04",
          },
        ],
        { id: "1", version_number: 7 }
      ),
      true
    );

    assert.equal(
      hasBlockingRevisionInLineage(
        [
          {
            id: "1",
            status: "ready_to_send",
            proof_lineage_id: "lineage-a",
            version_number: 7,
            created_at: "2026-01-02",
          },
          {
            id: "2",
            status: "cancelled",
            proof_lineage_id: "lineage-a",
            version_number: 8,
            created_at: "2026-01-03",
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
