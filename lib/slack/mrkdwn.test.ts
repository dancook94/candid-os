import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { escapeSlackMrkdwn } from "@/lib/slack/mrkdwn";

describe("escapeSlackMrkdwn", () => {
  it("escapes ampersands, less-than and greater-than", () => {
    assert.equal(escapeSlackMrkdwn("A & B <tag>"), "A &amp; B &lt;tag&gt;");
  });
});
