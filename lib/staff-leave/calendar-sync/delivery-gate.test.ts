import assert from "node:assert/strict";
import test from "node:test";

import { getStaffLeaveCalendarDeliveryGate } from "@/lib/staff-leave/calendar-sync/delivery-gate";

test("calendar sync is disabled by default", () => {
  const previousEnabled = process.env.STAFF_LEAVE_GCAL_ENABLED;
  const previousProvider = process.env.STAFF_LEAVE_GCAL_PROVIDER;
  delete process.env.STAFF_LEAVE_GCAL_ENABLED;
  delete process.env.STAFF_LEAVE_GCAL_PROVIDER;

  try {
    const gate = getStaffLeaveCalendarDeliveryGate();
    assert.equal(gate.allowed, false);
    if (!gate.allowed) {
      assert.equal(gate.reason, "calendar_sync_disabled");
    }
  } finally {
    if (previousEnabled === undefined) {
      delete process.env.STAFF_LEAVE_GCAL_ENABLED;
    } else {
      process.env.STAFF_LEAVE_GCAL_ENABLED = previousEnabled;
    }

    if (previousProvider === undefined) {
      delete process.env.STAFF_LEAVE_GCAL_PROVIDER;
    } else {
      process.env.STAFF_LEAVE_GCAL_PROVIDER = previousProvider;
    }
  }
});

test("mock provider requires explicit enable flag", () => {
  const previousEnabled = process.env.STAFF_LEAVE_GCAL_ENABLED;
  const previousProvider = process.env.STAFF_LEAVE_GCAL_PROVIDER;
  process.env.STAFF_LEAVE_GCAL_ENABLED = "true";
  process.env.STAFF_LEAVE_GCAL_PROVIDER = "mock";

  try {
    const gate = getStaffLeaveCalendarDeliveryGate();
    assert.equal(gate.allowed, true);
    if (gate.allowed) {
      assert.equal(gate.provider, "mock");
      assert.equal(gate.mockDelivery, true);
    }
  } finally {
    if (previousEnabled === undefined) {
      delete process.env.STAFF_LEAVE_GCAL_ENABLED;
    } else {
      process.env.STAFF_LEAVE_GCAL_ENABLED = previousEnabled;
    }

    if (previousProvider === undefined) {
      delete process.env.STAFF_LEAVE_GCAL_PROVIDER;
    } else {
      process.env.STAFF_LEAVE_GCAL_PROVIDER = previousProvider;
    }
  }
});

test("google provider stays blocked until implemented", () => {
  const previousEnabled = process.env.STAFF_LEAVE_GCAL_ENABLED;
  const previousProvider = process.env.STAFF_LEAVE_GCAL_PROVIDER;
  const previousJson = process.env.STAFF_LEAVE_GCAL_SERVICE_ACCOUNT_JSON;
  const previousTeam = process.env.STAFF_LEAVE_GCAL_TEAM_CALENDAR_ID;
  const previousSickness = process.env.STAFF_LEAVE_GCAL_SICKNESS_CALENDAR_ID;

  process.env.STAFF_LEAVE_GCAL_ENABLED = "true";
  process.env.STAFF_LEAVE_GCAL_PROVIDER = "google";
  process.env.STAFF_LEAVE_GCAL_SERVICE_ACCOUNT_JSON = "{}";
  process.env.STAFF_LEAVE_GCAL_TEAM_CALENDAR_ID = "team";
  process.env.STAFF_LEAVE_GCAL_SICKNESS_CALENDAR_ID = "sickness";

  try {
    const gate = getStaffLeaveCalendarDeliveryGate();
    assert.equal(gate.allowed, false);
    if (!gate.allowed) {
      assert.equal(gate.reason, "google_provider_not_implemented");
    }
  } finally {
    for (const [key, value, previous] of [
      ["STAFF_LEAVE_GCAL_ENABLED", previousEnabled],
      ["STAFF_LEAVE_GCAL_PROVIDER", previousProvider],
      ["STAFF_LEAVE_GCAL_SERVICE_ACCOUNT_JSON", previousJson],
      ["STAFF_LEAVE_GCAL_TEAM_CALENDAR_ID", previousTeam],
      ["STAFF_LEAVE_GCAL_SICKNESS_CALENDAR_ID", previousSickness],
    ] as const) {
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  }
});
