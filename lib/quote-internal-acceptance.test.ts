import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isCustomerQuoteAccessible,
  isQuoteVersionCustomerPublished,
} from "@/lib/quote-customer-publication";
import {
  canStaffAcceptQuoteOnBehalf,
  canStaffDeclineQuoteOnBehalf,
  isQuoteAwaitingDecision,
} from "@/lib/quote-status-response";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");

async function readRepoFile(relativePath: string) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

describe("staff acceptance gates", () => {
  it("A. staff can accept current draft quote", () => {
    assert.equal(
      canStaffAcceptQuoteOnBehalf({
        quoteStatus: "draft",
        versionStatus: "draft",
        versionNumber: 1,
        currentVersion: 1,
      }),
      true
    );
  });

  it("B. staff can still accept current sent quote", () => {
    assert.equal(
      canStaffAcceptQuoteOnBehalf({
        quoteStatus: "sent",
        versionStatus: "sent",
        versionNumber: 2,
        currentVersion: 2,
      }),
      true
    );
  });

  it("C. staff cannot accept terminal or non-current versions", () => {
    assert.equal(
      canStaffAcceptQuoteOnBehalf({
        quoteStatus: "accepted",
        versionStatus: "accepted",
        versionNumber: 1,
        currentVersion: 1,
      }),
      false
    );
    assert.equal(
      canStaffAcceptQuoteOnBehalf({
        quoteStatus: "draft",
        versionStatus: "draft",
        versionNumber: 1,
        currentVersion: 2,
      }),
      false
    );
  });

  it("D. draft decline remains unavailable", () => {
    assert.equal(
      canStaffDeclineQuoteOnBehalf({
        quoteStatus: "draft",
        versionStatus: "draft",
        versionNumber: 1,
        currentVersion: 1,
      }),
      false
    );
    assert.equal(
      canStaffDeclineQuoteOnBehalf({
        quoteStatus: "sent",
        versionStatus: "sent",
        versionNumber: 1,
        currentVersion: 1,
      }),
      true
    );
  });

  it("E. customer acceptance remains sent-only", () => {
    assert.equal(
      isQuoteAwaitingDecision({
        quoteStatus: "draft",
        versionStatus: "draft",
        versionNumber: 1,
        currentVersion: 1,
      }),
      false
    );
    assert.equal(
      isQuoteAwaitingDecision({
        quoteStatus: "sent",
        versionStatus: "sent",
        versionNumber: 1,
        currentVersion: 1,
      }),
      true
    );
  });
});

describe("customer publication", () => {
  it("M. never-sent accepted quote is not customer accessible", () => {
    assert.equal(isQuoteVersionCustomerPublished(null), false);
    assert.equal(isCustomerQuoteAccessible("accepted", null), false);
  });

  it("P. sent then accepted quote remains customer accessible", () => {
    assert.equal(
      isCustomerQuoteAccessible("accepted", "2026-09-08T10:00:00.000Z"),
      true
    );
    assert.equal(
      isCustomerQuoteAccessible("sent", "2026-09-08T10:00:00.000Z"),
      true
    );
    assert.equal(
      isCustomerQuoteAccessible("declined", "2026-09-08T10:00:00.000Z"),
      true
    );
  });
});

describe("implementation wiring", () => {
  it("F-J. admin draft acceptance writes draft to accepted without sent_at", async () => {
    const source = await readRepoFile("lib/quote-status-response.ts");

    assert.match(source, /applyAdminQuoteAcceptance/);
    assert.match(source, /status: "accepted"/);
    assert.match(source, /accepted_at: now/);
    assert.doesNotMatch(source, /sent_at:/);
    assert.match(source, /\.eq\("status", sourceQuoteStatus\)/);
    assert.match(source, /\.eq\("version_status", sourceVersionStatus\)/);
  });

  it("K. never-sent acceptance skips customer acceptance email", async () => {
    const source = await readRepoFile("lib/notifications/triggers.ts");

    assert.match(source, /sendCustomerNotification/);
    assert.match(source, /quote_not_published_to_customer/);
    assert.match(source, /quote_accepted_internal/);
  });

  it("N-O. customer formal quote loader blocks unpublished quotes", async () => {
    const source = await readRepoFile("lib/customer-formal-quote-data.ts");

    assert.match(source, /isQuoteVersionCustomerPublished\(displayVersion\.sent_at\)/);
  });

  it("M. customer company quotes filter requires sent_at", async () => {
    const source = await readRepoFile("lib/quote-request-link.ts");

    assert.match(source, /isQuoteVersionCustomerPublished\(currentVersion\?\.sent_at/);
  });

  it("T-U. customer job pages hide internal quote links", async () => {
    const list = await readRepoFile("components/customer-jobs-list.tsx");
    const detail = await readRepoFile("app/jobs/[id]/page.tsx");
    const loaders = await readRepoFile("lib/jobs/loaders.ts");

    assert.match(list, /quoteLinkPublished/);
    assert.match(list, /Internal quote/);
    assert.match(detail, /quoteLinkPublished/);
    assert.match(detail, /Internal quote/);
    assert.match(loaders, /quoteLinkPublished/);
  });

  it("R. customer job visibility remains company_id + customer_visible", async () => {
    const source = await readRepoFile("lib/jobs/loaders.ts");

    assert.match(source, /\.eq\("company_id", companyId\)/);
    assert.match(source, /\.eq\("customer_visible", true\)/);
  });

  it("Y. job creation still records accepted_by from actor", async () => {
    const source = await readRepoFile("lib/jobs/create-from-quote.ts");

    assert.match(source, /accepted_by: actorProfileId/);
    assert.match(source, /customer_visible: true/);
  });

  it("admin UI shows draft internal acceptance copy", async () => {
    const source = await readRepoFile("components/admin-quote-management-actions.tsx");

    assert.match(source, /Accept this draft internally\?/);
    assert.match(source, /without sending the quote to the customer/);
    assert.match(source, /canDeclineOnBehalf/);
  });

  it("customer routes do not use staff acceptance gate", async () => {
    const customer = await readRepoFile("lib/customer-quote-response.ts");

    assert.match(customer, /isQuoteAwaitingDecision/);
    assert.doesNotMatch(customer, /canStaffAcceptQuoteOnBehalf/);
  });
});
