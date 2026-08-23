import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildManifestItemProofCoverage,
  getManifestItemProofStatus,
  isManifestItemProofApproved,
  isProofCreatableManifestItem,
  partitionProofManifestItems,
  validateProofCreatableManifestItemSelection,
} from "@/lib/manifest/proof-requirement";
import {
  buildManifestItemPreCancellationState,
  defaultReinstateStateForItem,
} from "@/lib/manifest/cancellation-snapshot";
import type { ManifestItemRecord } from "@/lib/manifest/types";

function makeItem(
  overrides: Partial<ManifestItemRecord> & Pick<ManifestItemRecord, "id" | "item_name">
): ManifestItemRecord {
  return {
    job_id: "job-1",
    company_id: "company-1",
    quote_id: null,
    quote_version_id: null,
    quote_item_id: null,
    item_reference: overrides.item_reference ?? null,
    description: null,
    quantity: 1,
    quoted_quantity: 1,
    quote_unit_price: null,
    unit: "each",
    width_mm: null,
    height_mm: null,
    area_sqm: null,
    material: null,
    machine: null,
    media_profile: null,
    copies: null,
    sides: null,
    finishing_notes: null,
    internal_note: null,
    production_status: "artwork",
    production_requirement_status: "required",
    proof_requirement: "required",
    billing_status: "billable",
    source_type: "quoted",
    customer_change_reason: null,
    requires_printfactory: false,
    printfactory_satisfied: false,
    printfactory_match_status: "unmatched",
    printfactory_job_guid: null,
    synology_source_path: null,
    combined_into_item_id: null,
    customer_cancelled_at: null,
    customer_cancelled_by: null,
    priority: "normal",
    required_at: null,
    assigned_to_profile_id: null,
    customer_safe_status: "artwork",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    completed_at: null,
    deleted_at: null,
    ...overrides,
  };
}

describe("item-level proof requirements", () => {
  it("scenario A: one required item approved is satisfied", () => {
    const item = makeItem({ id: "item-1", item_name: "Foamex", proof_requirement: "required" });
    const proofs = [
      {
        id: "proof-v1",
        proof_lineage_id: "lineage-1",
        status: "approved",
        version_number: 1,
      },
    ];
    const links = [{ proof_id: "proof-v1", production_item_id: "item-1" }];

    assert.equal(isManifestItemProofApproved(item, proofs, links), true);
    assert.equal(buildManifestItemProofCoverage([item], proofs, links).satisfiedCount, 1);
  });

  it("scenario B: not required item is satisfied without proof", () => {
    const item = makeItem({
      id: "item-1",
      item_name: "Repeat Dibond",
      proof_requirement: "not_required",
    });

    assert.equal(isManifestItemProofApproved(item, [], []), true);
    assert.equal(buildManifestItemProofCoverage([item], [], []).requiredCount, 0);
  });

  it("scenario C: two of five items require proof and both approved completes proof", () => {
    const items = [
      makeItem({ id: "item-1", item_name: "Foamex", proof_requirement: "required" }),
      makeItem({ id: "item-2", item_name: "Vinyl", proof_requirement: "required" }),
      makeItem({ id: "item-3", item_name: "Repeat", proof_requirement: "not_required" }),
      makeItem({
        id: "item-4",
        item_name: "Installation",
        proof_requirement: "not_applicable",
        production_requirement_status: "not_required",
      }),
      makeItem({ id: "item-5", item_name: "Extra", proof_requirement: "not_required" }),
    ];
    const proofs = [
      {
        id: "proof-v1",
        proof_lineage_id: "lineage-1",
        status: "approved",
        version_number: 1,
      },
    ];
    const links = [
      { proof_id: "proof-v1", production_item_id: "item-1" },
      { proof_id: "proof-v1", production_item_id: "item-2" },
    ];

    const coverage = buildManifestItemProofCoverage(items, proofs, links);
    assert.equal(coverage.requiredCount, 2);
    assert.equal(coverage.satisfiedCount, 2);
  });

  it("scenario D: only one of two required items approved is incomplete", () => {
    const items = [
      makeItem({ id: "item-1", item_name: "Foamex", proof_requirement: "required" }),
      makeItem({ id: "item-2", item_name: "Vinyl", proof_requirement: "required" }),
    ];
    const proofs = [
      {
        id: "proof-v1",
        proof_lineage_id: "lineage-1",
        status: "approved",
        version_number: 1,
      },
    ];
    const links = [{ proof_id: "proof-v1", production_item_id: "item-1" }];

    const coverage = buildManifestItemProofCoverage(items, proofs, links);
    assert.equal(coverage.requiredCount, 2);
    assert.equal(coverage.satisfiedCount, 1);
  });

  it("scenario E: one approved proof covering two items satisfies both", () => {
    const items = [
      makeItem({ id: "item-1", item_name: "Foamex", proof_requirement: "required" }),
      makeItem({ id: "item-2", item_name: "Vinyl", proof_requirement: "required" }),
    ];
    const proofs = [
      {
        id: "proof-v1",
        proof_lineage_id: "lineage-1",
        status: "approved",
        version_number: 1,
      },
    ];
    const links = [
      { proof_id: "proof-v1", production_item_id: "item-1" },
      { proof_id: "proof-v1", production_item_id: "item-2" },
    ];

    const coverage = buildManifestItemProofCoverage(items, proofs, links);
    assert.equal(coverage.satisfiedCount, 2);
  });

  it("scenario F: approved v1 with active v2 draft requires approval again", () => {
    const item = makeItem({ id: "item-1", item_name: "Foamex", proof_requirement: "required" });
    const proofs = [
      {
        id: "proof-v1",
        proof_lineage_id: "lineage-1",
        status: "approved",
        version_number: 1,
      },
      {
        id: "proof-v2",
        proof_lineage_id: "lineage-1",
        status: "draft",
        version_number: 2,
      },
    ];
    const links = [
      { proof_id: "proof-v1", production_item_id: "item-1" },
      { proof_id: "proof-v2", production_item_id: "item-1" },
    ];

    assert.equal(getManifestItemProofStatus(item, proofs, links), "revision_preparing");
    assert.equal(isManifestItemProofApproved(item, proofs, links), false);
  });

  it("scenario G: cancelled manifest item does not count toward proof requirements", () => {
    const items = [
      makeItem({
        id: "item-1",
        item_name: "Foamex",
        proof_requirement: "required",
        production_requirement_status: "cancelled",
      }),
      makeItem({ id: "item-2", item_name: "Vinyl", proof_requirement: "required" }),
    ];

    const coverage = buildManifestItemProofCoverage(items, [], []);
    assert.equal(coverage.requiredCount, 1);
  });

  it("scenario A: not required items cannot be selected for new proofs", () => {
    const item = makeItem({
      id: "item-1",
      item_name: "Repeat Dibond",
      proof_requirement: "not_required",
    });

    assert.equal(isProofCreatableManifestItem(item), false);

    const { selectableItems, disabledItems } = partitionProofManifestItems([item]);
    assert.equal(selectableItems.length, 0);
    assert.equal(disabledItems.length, 1);

    const validation = validateProofCreatableManifestItemSelection([item], [item.id]);
    assert.equal(validation.ok, false);
  });

  it("scenario B: switching back to required makes item proof-creatable", () => {
    const item = makeItem({
      id: "item-1",
      item_name: "Repeat Dibond",
      proof_requirement: "required",
    });

    assert.equal(isProofCreatableManifestItem(item), true);

    const validation = validateProofCreatableManifestItemSelection([item], [item.id]);
    assert.equal(validation.ok, true);
  });

  it("scenario C: cancelled items are excluded from proof creation selection", () => {
    const item = makeItem({
      id: "item-1",
      item_name: "Foamex",
      proof_requirement: "not_applicable",
      production_requirement_status: "cancelled",
    });

    assert.equal(isProofCreatableManifestItem(item), false);
    assert.equal(
      validateProofCreatableManifestItemSelection([item], [item.id]).ok,
      false
    );
  });

  it("scenario D: cancellation snapshot preserves state for reinstatement", () => {
    const item = makeItem({
      id: "item-1",
      item_name: "Foamex",
      proof_requirement: "required",
      billing_status: "billable",
      production_status: "artwork",
      production_requirement_status: "required",
    });

    const snapshot = buildManifestItemPreCancellationState(item);
    assert.deepEqual(snapshot, {
      production_requirement_status: "required",
      billing_status: "billable",
      production_status: "artwork",
      proof_requirement: "required",
    });

    const fallback = defaultReinstateStateForItem({
      item_name: "Foamex",
      production_status: "artwork",
    });
    assert.equal(fallback.production_requirement_status, "required");
    assert.equal(fallback.billing_status, "billable");
    assert.equal(fallback.proof_requirement, "required");
  });

  it("scenario E: multi-item proof rejects mixed required and not required items", () => {
    const items = [
      makeItem({ id: "item-1", item_name: "Foamex", proof_requirement: "required" }),
      makeItem({ id: "item-2", item_name: "Repeat", proof_requirement: "not_required" }),
    ];

    const validation = validateProofCreatableManifestItemSelection(items, [
      "item-1",
      "item-2",
    ]);
    assert.equal(validation.ok, false);
  });
});
