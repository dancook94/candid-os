import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clampSyncDateTimeFrom,
  filterPrintfactoryRecordsByOperationalWindow,
  getPrintfactoryMatchingGoLiveDate,
  getPrintfactoryMatchingGoLiveIso,
  isPrintfactoryRecordOnOrAfterGoLive,
  parsePrintfactoryMatchingGoLiveDate,
  PrintfactoryGoLiveConfigError,
  PRINTFACTORY_MATCHING_GO_LIVE_DEFAULT,
} from "@/lib/printfactory/matching-config";

function withGoLiveEnv(value: string | undefined, run: () => void) {
  const original = process.env.PRINTFACTORY_MATCHING_GO_LIVE_DATE;

  if (value === undefined) {
    delete process.env.PRINTFACTORY_MATCHING_GO_LIVE_DATE;
  } else {
    process.env.PRINTFACTORY_MATCHING_GO_LIVE_DATE = value;
  }

  try {
    run();
  } finally {
    if (original === undefined) {
      delete process.env.PRINTFACTORY_MATCHING_GO_LIVE_DATE;
    } else {
      process.env.PRINTFACTORY_MATCHING_GO_LIVE_DATE = original;
    }
  }
}

describe("parsePrintfactoryMatchingGoLiveDate", () => {
  it("parses valid YYYY-MM-DD as UTC midnight", () => {
    const date = parsePrintfactoryMatchingGoLiveDate("2026-09-08");
    assert.equal(date.toISOString(), "2026-09-08T00:00:00.000Z");
  });

  it("parses valid ISO timestamp with Z exactly", () => {
    const date = parsePrintfactoryMatchingGoLiveDate("2026-09-08T16:45:00.000Z");
    assert.equal(date.toISOString(), "2026-09-08T16:45:00.000Z");
  });

  it("parses valid ISO timestamp with explicit offset", () => {
    const date = parsePrintfactoryMatchingGoLiveDate("2026-09-08T17:45:00+01:00");
    assert.equal(date.toISOString(), "2026-09-08T16:45:00.000Z");
  });

  it("throws on invalid values", () => {
    assert.throws(
      () => parsePrintfactoryMatchingGoLiveDate("2026-09-08T16:45:00.000ZT00:00:00.000Z"),
      PrintfactoryGoLiveConfigError
    );
    assert.throws(
      () => parsePrintfactoryMatchingGoLiveDate("not-a-date"),
      PrintfactoryGoLiveConfigError
    );
    assert.throws(() => parsePrintfactoryMatchingGoLiveDate(""), PrintfactoryGoLiveConfigError);
  });
});

describe("getPrintfactoryMatchingGoLiveDate env resolution", () => {
  it("uses the existing default when env is missing", () => {
    withGoLiveEnv(undefined, () => {
      assert.equal(
        getPrintfactoryMatchingGoLiveIso(),
        `${PRINTFACTORY_MATCHING_GO_LIVE_DEFAULT}T00:00:00.000Z`
      );
    });
  });

  it("throws when env is set but invalid", () => {
    withGoLiveEnv("2026-13-40", () => {
      assert.throws(() => getPrintfactoryMatchingGoLiveDate(), PrintfactoryGoLiveConfigError);
    });
  });
});

describe("operational cutover precision", () => {
  const cutover = "2026-09-08T16:45:00.000Z";
  const before = {
    created_at_printfactory: "2026-09-08T16:44:59.000Z",
    first_seen_at: "2026-09-08T16:44:59.000Z",
  };
  const after = {
    created_at_printfactory: "2026-09-08T16:45:01.000Z",
    first_seen_at: "2026-09-08T16:45:01.000Z",
  };

  it("excludes records one minute before cutover", () => {
    withGoLiveEnv(cutover, () => {
      assert.equal(isPrintfactoryRecordOnOrAfterGoLive(before), false);
      const operational = filterPrintfactoryRecordsByOperationalWindow([before, after], {});
      assert.deepEqual(operational, [after]);
    });
  });

  it("includes records one minute after cutover", () => {
    withGoLiveEnv(cutover, () => {
      assert.equal(isPrintfactoryRecordOnOrAfterGoLive(after), true);
    });
  });

  it("clamps live sync DateTimeFrom to the exact cutover timestamp", () => {
    withGoLiveEnv(cutover, () => {
      const clamped = clampSyncDateTimeFrom("2026-09-08T15:00:00.000Z");
      assert.equal(clamped, cutover);

      const unchanged = clampSyncDateTimeFrom("2026-09-08T17:00:00.000Z");
      assert.equal(unchanged, "2026-09-08T17:00:00.000Z");
    });
  });
});
