import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { proofArtifactMatchesVersion } from "@/lib/proofs/dropbox";

describe("proofArtifactMatchesVersion", () => {
  it("matches versioned proof filenames and paths", () => {
    assert.equal(
      proofArtifactMatchesVersion("J-4-01-Proof-v2.pdf", null, 2),
      true
    );
    assert.equal(
      proofArtifactMatchesVersion(
        null,
        "/jobs/J-4/03 Proofs/J-4-01-Proof-v2.pdf",
        2
      ),
      true
    );
    assert.equal(
      proofArtifactMatchesVersion("J-4-01-Proof-v1.pdf", null, 2),
      false
    );
  });
});
