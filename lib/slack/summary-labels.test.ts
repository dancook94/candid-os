import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatSlackJobArtworkLabel,
  formatSlackJobProofLabel,
  formatSlackProductionBoardStageLabel,
  formatSlackProductionDeadlineLabel,
  resolveSlackDropboxWebUrl,
} from "@/lib/slack/summary-labels";

describe("slack summary labels", () => {
  it("derives artwork labels from canonical job fields", () => {
    assert.equal(
      formatSlackJobArtworkLabel({
        artworkSource: "customer_pending",
        jobStatus: "awaiting_artwork",
      }),
      "Awaiting artwork"
    );
    assert.equal(
      formatSlackJobArtworkLabel({
        artworkSource: "portal_upload",
        jobStatus: "artwork_received",
      }),
      "Artwork received"
    );
  });

  it("derives proof labels without changing proof logic", () => {
    assert.equal(
      formatSlackJobProofLabel({ proofRequired: false, proofWorkflowStatus: "no_proof" }),
      "Not required"
    );
    assert.equal(
      formatSlackJobProofLabel({ proofRequired: true, proofWorkflowStatus: "no_proof" }),
      "Required"
    );
    assert.equal(
      formatSlackJobProofLabel({
        proofRequired: true,
        proofWorkflowStatus: "awaiting_customer",
      }),
      "Proof sent"
    );
  });

  it("uses production board stage labels", () => {
    assert.equal(
      formatSlackProductionBoardStageLabel("accepted_quotes"),
      "Accepted Quotes"
    );
  });

  it("formats production deadline with not set fallback", () => {
    assert.equal(formatSlackProductionDeadlineLabel(null, null), "Not set");
    assert.match(formatSlackProductionDeadlineLabel("2026-09-18", "10:00"), /18 Sep/);
    assert.match(formatSlackProductionDeadlineLabel("2026-09-18", "10:00"), /10:00/);
  });

  it("does not fabricate Dropbox URLs from folder paths", () => {
    assert.equal(resolveSlackDropboxWebUrl("/Candid/J-1"), null);
    assert.equal(
      resolveSlackDropboxWebUrl("https://www.dropbox.com/home/Candid"),
      "https://www.dropbox.com/home/Candid"
    );
  });
});
