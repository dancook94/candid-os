import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { quoteSendBlockedByIncompleteCostingMessage } from "@/lib/quotes/send-costing-guard";

test("send quote checks stored incomplete costing", () => {
  const send = readFileSync("lib/quotes/send-quote.ts", "utf8");
  assert.match(send, /assertQuoteVersionCostingCompleteForSend/);
});

test("send block message is stable", () => {
  assert.match(
    quoteSendBlockedByIncompleteCostingMessage(),
    /Complete internal costing/
  );
});

test("quote builder blocks send when profitability is provisional", () => {
  const form = readFileSync("components/quote-builder-form.tsx", "utf8");
  assert.match(form, /profitFigures\.provisional/);
});
