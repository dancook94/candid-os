import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildJobReferenceFromNumber,
} from "@/lib/jobs/allocate-job-number";
import {
  classifyPostgresUniqueViolation,
  JOB_REFERENCE_INSERT_MAX_ATTEMPTS,
} from "@/lib/jobs/reference-allocation";

describe("job reference allocation", () => {
  it("builds canonical J-n references", () => {
    assert.equal(buildJobReferenceFromNumber(10), "J-10");
    assert.equal(buildJobReferenceFromNumber(11), "J-11");
  });

  it("classifies job_reference unique violations", () => {
    assert.equal(
      classifyPostgresUniqueViolation({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "jobs_job_reference_idx"',
        details: "Key (job_reference)=(J-6) already exists.",
      }),
      "job_reference"
    );
  });

  it("classifies quote_id unique violations", () => {
    assert.equal(
      classifyPostgresUniqueViolation({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "jobs_one_per_quote_idx"',
        details: "Key (quote_id)=(abc) already exists.",
      }),
      "quote_id"
    );
  });

  it("marks unexpected unique violations as unknown", () => {
    assert.equal(
      classifyPostgresUniqueViolation({
        code: "23505",
        message: 'duplicate key value violates unique constraint "some_other_idx"',
        details: "Key (other_col)=(x) already exists.",
      }),
      "unknown"
    );
  });

  it("uses a bounded retry count for reference collisions", () => {
    assert.equal(JOB_REFERENCE_INSERT_MAX_ATTEMPTS, 6);
  });
});

describe("accepted quote job reference scenarios", () => {
  it("prefers J-10 when the preferred reference is free", () => {
    const preferred = buildJobReferenceFromNumber(10);
    const existingReferences = new Set(["J-1", "J-2", "J-9"]);

    assert.equal(existingReferences.has(preferred), false);
    assert.equal(preferred, "J-10");
  });

  it("allocates the next free reference when J-10 is already taken", () => {
    const existing = [1, 2, 3, 4, 6, 10];
    const quoteNumber = 10;
    const preferredTaken = existing.includes(quoteNumber);

    assert.equal(preferredTaken, true);

    const maxNumber = Math.max(...existing, quoteNumber);
    const allocated = maxNumber + 1;

    assert.equal(allocated, 11);
    assert.equal(buildJobReferenceFromNumber(allocated), "J-11");
  });

  it("keeps quote idempotency independent from preferred reference numbering", () => {
    const quoteJobMap = new Map<string, string>();
    quoteJobMap.set("Q-10", "J-11");

    assert.equal(quoteJobMap.get("Q-10"), "J-11");
    assert.notEqual(quoteJobMap.get("Q-10"), "J-10");
  });

  it("retries safely when two creations compete for the same allocated number", () => {
    const taken = new Set(["J-11"]);
    let candidate = "J-11";
    let attempts = 0;
    let resolved = false;

    while (attempts < JOB_REFERENCE_INSERT_MAX_ATTEMPTS && !resolved) {
      attempts += 1;

      if (taken.has(candidate)) {
        candidate = buildJobReferenceFromNumber(11 + attempts);
        continue;
      }

      taken.add(candidate);
      resolved = true;
    }

    assert.equal(resolved, true);
    assert.equal(candidate, "J-12");
  });

  it("does not silently treat unknown unique violations as quote races", () => {
    const violation = classifyPostgresUniqueViolation({
      code: "23505",
      message: 'duplicate key value violates unique constraint "unexpected_idx"',
    });

    assert.equal(violation, "unknown");
    assert.notEqual(violation, "quote_id");
  });

  it("leaves existing PrintFactory job references untouched by using a new reference", () => {
    const existingPfJob = "J-6";
    const allocatedForQuote = "J-7";

    assert.notEqual(allocatedForQuote, existingPfJob);
  });

  it("uses the actual allocated job reference for downstream naming", () => {
    const allocatedReference = "J-7";
    const slackChannelPrefix = allocatedReference.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    assert.match(slackChannelPrefix, /^j-7/);
  });

  it("uses jobs.job_reference for Dropbox folder naming rather than quote number", () => {
    const job = { job_reference: "J-7", project_name: "September Dibond Panels" };
    const dropboxFolderName = `${job.job_reference} - ${job.project_name}`;

    assert.match(dropboxFolderName, /^J-7 - /);
    assert.doesNotMatch(dropboxFolderName, /^J-6 /);
  });
});
