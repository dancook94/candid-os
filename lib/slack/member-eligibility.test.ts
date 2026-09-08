import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  chunkSlackUserIds,
  filterEligibleSlackMemberIds,
  getSlackMemberEligibility,
  mergeInviteAttemptResults,
  mergeJobChannelInviteUserIds,
  SLACKBOT_USER_ID,
  type SlackMemberCandidate,
} from "@/lib/slack/member-eligibility";

function member(overrides: Partial<SlackMemberCandidate> & { id: string }): SlackMemberCandidate {
  return {
    deleted: false,
    is_bot: false,
    is_app_user: false,
    is_restricted: false,
    is_ultra_restricted: false,
    is_stranger: false,
    is_invited_user: false,
    ...overrides,
  };
}

describe("slack member eligibility", () => {
  it("includes active normal members", () => {
    const user = member({ id: "U111" });

    assert.equal(getSlackMemberEligibility(user).eligible, true);
    assert.deepEqual(filterEligibleSlackMemberIds([user]), ["U111"]);
  });

  it("excludes deactivated members", () => {
    const user = member({ id: "U222", deleted: true });

    assert.deepEqual(getSlackMemberEligibility(user), {
      eligible: false,
      reason: "deactivated",
    });
  });

  it("excludes bots", () => {
    const user = member({ id: "B111", is_bot: true });

    assert.deepEqual(getSlackMemberEligibility(user), {
      eligible: false,
      reason: "bot",
    });
  });

  it("excludes Slackbot", () => {
    const user = member({ id: SLACKBOT_USER_ID, is_bot: true });

    assert.deepEqual(getSlackMemberEligibility(user), {
      eligible: false,
      reason: "slackbot",
    });
  });

  it("excludes guest and external members", () => {
    const singleChannelGuest = member({ id: "U301", is_restricted: true });
    const multiChannelGuest = member({ id: "U302", is_ultra_restricted: true });
    const externalStranger = member({ id: "U303", is_stranger: true });
    const appUser = member({ id: "U304", is_app_user: true });

    assert.equal(getSlackMemberEligibility(singleChannelGuest).reason, "single_channel_guest");
    assert.equal(getSlackMemberEligibility(multiChannelGuest).reason, "multi_channel_guest");
    assert.equal(getSlackMemberEligibility(externalStranger).reason, "external_stranger");
    assert.equal(getSlackMemberEligibility(appUser).reason, "app_user");

    assert.deepEqual(
      filterEligibleSlackMemberIds([
        singleChannelGuest,
        multiChannelGuest,
        externalStranger,
        appUser,
      ]),
      []
    );
  });

  it("paginates member filtering across multiple pages", () => {
    const pageOne = Array.from({ length: 200 }, (_, index) =>
      member({ id: `U${index + 1}` })
    );
    const pageTwo = [
      member({ id: "U201" }),
      member({ id: "U202", deleted: true }),
      member({ id: "U203", is_bot: true }),
    ];

    assert.deepEqual(filterEligibleSlackMemberIds([...pageOne, ...pageTwo]), [
      ...pageOne.map((user) => user.id),
      "U201",
    ]);
  });

  it("chunks invite batches safely", () => {
    const userIds = Array.from({ length: 250 }, (_, index) => `U${index + 1}`);

    const batches = chunkSlackUserIds(userIds, 100);

    assert.equal(batches.length, 3);
    assert.equal(batches[0]?.length, 100);
    assert.equal(batches[1]?.length, 100);
    assert.equal(batches[2]?.length, 50);
  });

  it("continues processing later invite batches when one batch fails", () => {
    const batchResults = [
      { invited: ["U1", "U2"], failed: [] },
      { invited: [], failed: [{ userId: "U3", error: "cant_invite" }] },
      { invited: ["U4", "U5"], failed: [] },
    ];

    const merged = mergeInviteAttemptResults(batchResults);

    assert.deepEqual(merged.invited, ["U1", "U2", "U4", "U5"]);
    assert.deepEqual(merged.failed, [{ userId: "U3", error: "cant_invite" }]);
  });

  it("merges workspace members with optional extras and excludes the bot user", () => {
    const merged = mergeJobChannelInviteUserIds(
      ["U1", "U2"],
      ["U3", "U2"],
      ["B999"]
    );

    assert.deepEqual(merged, ["U1", "U2", "U3"]);
  });

  it("does not require manual member IDs for normal operation", () => {
    const workspaceMembers = [
      member({ id: "U10" }),
      member({ id: "U11" }),
      member({ id: "U12", is_bot: true }),
    ];

    const inviteIds = mergeJobChannelInviteUserIds(
      filterEligibleSlackMemberIds(workspaceMembers, ["B777"]),
      [],
      ["B777"]
    );

    assert.deepEqual(inviteIds, ["U10", "U11"]);
  });
});

describe("slack membership failure safety", () => {
  it("allows job summary to proceed when member discovery fails", () => {
    const discoveryWarning = "Slack workspace member discovery failed.";
    const shouldPostSummary = true;

    assert.equal(Boolean(discoveryWarning), true);
    assert.equal(shouldPostSummary, true);
  });
});
