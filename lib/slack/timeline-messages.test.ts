import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildProductionStageChangedTimelineMessage,
  resolveDeadlineTimelineMessage,
} from "@/lib/slack/timeline-messages";
import { JOB_PRODUCTION_BOARD_STAGE_LABELS } from "@/lib/production/job-board-constants";

describe("resolveDeadlineTimelineMessage", () => {
  const at = new Date("2026-09-11T09:42:00.000Z");

  it("returns set message when deadline goes from null to a date", () => {
    const message = resolveDeadlineTimelineMessage({
      oldDate: null,
      newDate: "2026-09-18",
      actorName: "Bea",
      at,
    });

    assert.ok(message);
    assert.match(message!.text, /Production deadline set/);
    assert.match(message!.text, /18 Sep/);
    assert.match(message!.text, /Updated by Bea/);
  });

  it("returns updated message when deadline changes", () => {
    const message = resolveDeadlineTimelineMessage({
      oldDate: "2026-09-17",
      newDate: "2026-09-18",
      actorName: "Bea",
      at,
    });

    assert.ok(message);
    assert.match(message!.text, /Production deadline updated/);
    assert.match(message!.text, /17 Sep/);
    assert.match(message!.text, /18 Sep/);
  });

  it("returns cleared message when deadline is removed", () => {
    const message = resolveDeadlineTimelineMessage({
      oldDate: "2026-09-18",
      newDate: null,
      actorName: "Bea",
      at,
    });

    assert.ok(message);
    assert.match(message!.text, /Production deadline cleared/);
    assert.match(message!.text, /Previously/);
  });

  it("returns null when old and new dates are the same", () => {
    assert.equal(
      resolveDeadlineTimelineMessage({
        oldDate: "2026-09-18",
        newDate: "2026-09-18",
      }),
      null
    );
  });
});

describe("buildProductionStageChangedTimelineMessage", () => {
  it("uses human-readable stage labels including Complete Job", () => {
    const dispatchLabel = JOB_PRODUCTION_BOARD_STAGE_LABELS.dispatch;
    const completeLabel = JOB_PRODUCTION_BOARD_STAGE_LABELS.complete_job;

    const message = buildProductionStageChangedTimelineMessage({
      previousLabel: dispatchLabel,
      newLabel: completeLabel,
      actorName: "Dan",
      at: new Date("2026-09-11T10:05:00.000Z"),
    });

    assert.match(message.text, /Production stage changed/);
    assert.match(message.text, new RegExp(`${dispatchLabel} → ${completeLabel}`));
    assert.doesNotMatch(message.text, /Job complete/i);
    assert.match(message.text, /Updated by Dan/);
  });
});
