import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isEditableDraftForRegeneration,
  isLockedProofVersion,
  versionedProofFileMatchesProof,
} from "@/lib/proofs/generated-proof-upload";

describe("generated proof upload policy helpers", () => {
  it("treats draft and internal_review as editable for regeneration", () => {
    assert.equal(isEditableDraftForRegeneration("draft"), true);
    assert.equal(isEditableDraftForRegeneration("internal_review"), true);
    assert.equal(isEditableDraftForRegeneration("ready_to_send"), false);
  });

  it("treats sent and approved statuses as locked", () => {
    assert.equal(isLockedProofVersion("sent"), true);
    assert.equal(isLockedProofVersion("approved"), true);
    assert.equal(isLockedProofVersion("draft"), false);
  });

  it("matches versioned proof filenames to proof version numbers", () => {
    assert.equal(
      versionedProofFileMatchesProof({
        fileName: "J-4-01-Proof-v6.pdf",
        dropboxPath: "/job/03 proofs/j-4-01-proof-v6.pdf",
        versionNumber: 6,
      }),
      true
    );
    assert.equal(
      versionedProofFileMatchesProof({
        fileName: "J-4-01-Proof-v7.pdf",
        dropboxPath: "/job/03 proofs/j-4-01-proof-v7.pdf",
        versionNumber: 6,
      }),
      false
    );
  });
});
