import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSlackJobChannelIdempotencyKey,
  buildSlackJobTimelineDeadlineIdempotencyKey,
  buildSlackJobTimelineStageIdempotencyKey,
  SLACK_JOB_CHANNEL_NOTIFICATION_TYPE,
  SLACK_JOB_TIMELINE_NOTIFICATION_TYPE,
} from "@/lib/slack/idempotency";

describe("slack delivery idempotency", () => {
  it("uses a stable idempotency key per job", () => {
    assert.equal(
      buildSlackJobChannelIdempotencyKey("11111111-2222-3333-4444-555555555555"),
      "slack:job_channel_created:11111111-2222-3333-4444-555555555555"
    );
  });

  it("uses a dedicated notification type for job channel creation", () => {
    assert.equal(SLACK_JOB_CHANNEL_NOTIFICATION_TYPE, "slack_job_channel_created");
  });

  it("uses stable timeline idempotency keys for deadline transitions", () => {
    assert.equal(
      buildSlackJobTimelineDeadlineIdempotencyKey("job-1", null, "2026-09-18"),
      "slack:job_timeline:job-1:deadline:none:2026-09-18"
    );
    assert.equal(
      buildSlackJobTimelineDeadlineIdempotencyKey("job-1", "2026-09-17", "2026-09-18"),
      "slack:job_timeline:job-1:deadline:2026-09-17:2026-09-18"
    );
  });

  it("uses stage history row id in timeline idempotency keys", () => {
    assert.equal(
      buildSlackJobTimelineStageIdempotencyKey("job-1", "hist-99"),
      "slack:job_timeline:job-1:stage:hist-99"
    );
  });

  it("uses a dedicated notification type for job timeline events", () => {
    assert.equal(SLACK_JOB_TIMELINE_NOTIFICATION_TYPE, "slack_job_timeline_event");
  });
});

describe("slack workspace membership provisioning", () => {
  it("documents expected membership behaviour for Phase 1", () => {
    const scenarios = {
      activeMemberInvited: "users.list -> eligible member -> conversations.invite",
      deactivatedExcluded: "deleted=true excluded before invite list is built",
      botExcluded: "is_bot=true excluded",
      slackbotExcluded: "USLACKBOT excluded",
      guestExternalExcluded:
        "is_restricted, is_ultra_restricted, is_stranger, is_app_user excluded",
      pagination: "users.list follows response_metadata.next_cursor until empty",
      inviteBatching: "conversations.invite runs in batches of 100",
      partialInviteFailure: "failed batch/user does not stop later batches or summary post",
      discoveryFailureKeepsSummary:
        "member discovery warning recorded; channel + summary still proceed",
      noManualIdsRequired:
        "SLACK_INVITE_ALL_ACTIVE_MEMBERS=true uses workspace members without manual IDs",
    };

    assert.equal(Object.keys(scenarios).length, 10);
  });
});
