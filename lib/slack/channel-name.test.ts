import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildJobSlackChannelName,
  buildSlackChannelOpenUrl,
  slugifyChannelSegment,
} from "@/lib/slack/channel-name";

describe("slack channel naming", () => {
  it("builds j-{job-ref}-{project-slug} without customer/company", () => {
    const name = buildJobSlackChannelName({
      jobReference: "J-7",
      companyName: "Dan C",
      projectName: "September Dibond Panels",
    });

    assert.equal(name, "j-7-september-dibond-panels");
    assert.doesNotMatch(name, /dan/);
  });

  it("preserves the job reference number at the start", () => {
    const name = buildJobSlackChannelName({
      jobReference: "J-1897",
      projectName: "Exhibition Graphics",
    });

    assert.ok(name.startsWith("j-1897-"));
  });

  it("applies optional prefix and collision suffix", () => {
    const name = buildJobSlackChannelName({
      jobReference: "J-7",
      projectName: "September Dibond Panels",
      prefix: "candid-",
      collisionSuffix: "-2",
    });

    assert.equal(name, "candid-j-7-september-dibond-panels-2");
  });

  it("truncates long project slugs while preserving the job reference prefix", () => {
    const name = buildJobSlackChannelName({
      jobReference: "J-1897",
      projectName:
        "International Exhibition Graphics and Large Format Display Programme",
    });

    assert.ok(name.length <= 80);
    assert.ok(name.startsWith("j-1897-"));
    assert.doesNotMatch(name, /salesforce/);
  });

  it("slugifies special characters", () => {
    assert.equal(slugifyChannelSegment("ExCeL London"), "excel-london");
    assert.equal(slugifyChannelSegment("PO #12345"), "po-12345");
  });

  it("builds a Slack deep link from channel ID", () => {
    assert.equal(
      buildSlackChannelOpenUrl("C01234567"),
      "https://slack.com/app_redirect?channel=C01234567"
    );
  });
});
