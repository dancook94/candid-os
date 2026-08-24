import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findEditableDraftProofs,
  getDraftProgressSummary,
  hasValidGeneratedCustomerProof,
  isGeneratedPdfStale,
} from "@/lib/proofs/draft-workflow";
import type { JobProofView } from "@/lib/proofs/types";

function buildProof(overrides: Partial<JobProofView> = {}): JobProofView {
  return {
    id: "proof-1",
    job_id: "job-1",
    company_id: "company-1",
    proof_lineage_id: "lineage-1",
    proof_reference: "J-4 Proof v6",
    version_number: 6,
    status: "draft",
    title: "Foamex Panels",
    artwork_origin: "customer_uploaded",
    customer_message: null,
    internal_note: null,
    created_by_profile_id: null,
    sent_by_profile_id: null,
    sent_at: null,
    viewed_at: null,
    approved_at: null,
    approved_by_profile_id: null,
    changes_requested_at: null,
    changes_requested_comment: null,
    changes_requested_by_profile_id: null,
    superseded_at: null,
    cancelled_at: null,
    internal_review_at: null,
    internal_review_by_profile_id: null,
    ready_to_send_at: null,
    ready_to_send_by_profile_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    brandedPdfGeneratedAt: null,
    preflightSummary: null,
    files: [],
    manifestItems: [],
    ...overrides,
  };
}

describe("findEditableDraftProofs", () => {
  it("returns current editable drafts per lineage", () => {
    const drafts = findEditableDraftProofs([
      buildProof({ id: "v6", version_number: 6, status: "draft" }),
      buildProof({
        id: "v5",
        version_number: 5,
        status: "draft",
        proof_lineage_id: "lineage-1",
      }),
      buildProof({
        id: "other",
        version_number: 1,
        status: "ready_to_send",
        proof_lineage_id: "lineage-2",
        title: "Dibond Panels",
      }),
    ]);

    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]?.id, "v6");
    assert.equal(drafts[0]?.lineageTitle, "Foamex Panels");
  });
});

describe("isGeneratedPdfStale", () => {
  it("marks generated PDF stale when source artwork changed after generation", () => {
    const proof = buildProof({
      brandedPdfGeneratedAt: "2026-01-01T10:00:00.000Z",
      preflightSummary: {
        overallStatus: "manual_review",
        updatedAt: "2026-01-01T10:00:00.000Z",
        generatedAt: "2026-01-01T10:00:00.000Z",
        sourceDropboxPath: "/old/path.pdf",
      },
      files: [
        {
          id: "source",
          proof_id: "proof-1",
          file_role: "source_artwork",
          job_file_id: null,
          dropbox_file_id: null,
          dropbox_path: "/new/path.pdf",
          dropbox_revision: null,
          file_name: "new.pdf",
          mime_type: "application/pdf",
          file_size_bytes: 100,
          content_hash: null,
          preview_dropbox_path: null,
          preview_metadata: null,
          created_at: "2026-01-02T10:00:00.000Z",
          location_type: null,
          is_customer_facing: false,
        },
        {
          id: "customer",
          proof_id: "proof-1",
          file_role: "customer_proof",
          job_file_id: null,
          dropbox_file_id: null,
          dropbox_path: "/proofs/proof.pdf",
          dropbox_revision: null,
          file_name: "J-4-01-Proof-v6.pdf",
          mime_type: "application/pdf",
          file_size_bytes: 100,
          content_hash: null,
          preview_dropbox_path: null,
          preview_metadata: null,
          created_at: "2026-01-01T11:00:00.000Z",
          location_type: null,
          is_customer_facing: true,
        },
      ],
    });

    assert.equal(isGeneratedPdfStale(proof), true);
    assert.equal(hasValidGeneratedCustomerProof(proof), false);
  });
});

describe("getDraftProgressSummary", () => {
  it("summarises draft workflow progress", () => {
    const summary = getDraftProgressSummary(
      buildProof({
        brandedPdfGeneratedAt: "2026-01-01T10:00:00.000Z",
        preflightSummary: {
          overallStatus: "manual_review",
          updatedAt: "2026-01-01T09:00:00.000Z",
          generatedAt: "2026-01-01T10:00:00.000Z",
          sourceDropboxPath: "/art.pdf",
        },
        files: [
          {
            id: "source",
            proof_id: "proof-1",
            file_role: "source_artwork",
            job_file_id: null,
            dropbox_file_id: null,
            dropbox_path: "/art.pdf",
            dropbox_revision: null,
            file_name: "art.pdf",
            mime_type: "application/pdf",
            file_size_bytes: 100,
            content_hash: null,
            preview_dropbox_path: null,
            preview_metadata: null,
            created_at: "2026-01-01T08:00:00.000Z",
            location_type: null,
            is_customer_facing: false,
          },
          {
            id: "customer",
            proof_id: "proof-1",
            file_role: "customer_proof",
            job_file_id: null,
            dropbox_file_id: null,
            dropbox_path: "/proofs/proof.pdf",
            dropbox_revision: null,
            file_name: "J-4-01-Proof-v6.pdf",
            mime_type: "application/pdf",
            file_size_bytes: 100,
            content_hash: null,
            preview_dropbox_path: null,
            preview_metadata: null,
            created_at: "2026-01-01T10:00:00.000Z",
            location_type: null,
            is_customer_facing: true,
          },
        ],
      })
    );

    assert.match(summary.sourceArtwork, /Attached/);
    assert.equal(summary.preflight, "Complete — manual review");
    assert.equal(summary.generatedPdf, "J-4-01-Proof-v6.pdf");
    assert.equal(summary.internalReview, "Not submitted");
  });
});
