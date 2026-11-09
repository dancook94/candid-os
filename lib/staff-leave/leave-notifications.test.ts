import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { applyEmailModeRedirect } from "@/lib/notifications/email-mode";
import { getStaffLeaveDeliveryGate } from "@/lib/staff-leave/notifications/delivery-safety";
import {
  DEFAULT_INTERNAL_ROUTING,
  INTERNAL_RECIPIENT_GROUPS,
} from "@/lib/notifications/notification-types";
import {
  getDefaultNotificationSettings,
  normalizeNotificationSettings,
  resolveInternalRecipientEmails,
} from "@/lib/notifications/settings";
import { buildStaffLeaveEmailMetadata } from "@/lib/staff-leave/notifications/build-metadata";
import {
  mapOutboxKindToNotificationType,
  staffLeaveNotificationIdempotencyKey,
} from "@/lib/staff-leave/notifications/map-kind";
import { STAFF_LEAVE_OUTBOX_KINDS } from "@/lib/staff-leave/notifications/kinds";
import { formatLeaveDateRange, formatLeaveKindLabel } from "@/lib/staff-leave/notifications/format";

const MIGRATION = new URL(
  "../../supabase/migrations/20270110155000_staff_leave_email_notifications.sql",
  import.meta.url
);

test("migration defines outbox, trigger, and staff leave management settings merge", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /staff_leave_notification_outbox/);
  assert.match(sql, /staff_leave_notification_enqueue_from_event/);
  assert.match(sql, /staff_leave_notification_enqueue_trigger/);
  assert.match(sql, /management_annual_submitted/);
  assert.match(sql, /employee_additional_paid_granted/);
  assert.match(sql, /staff_leave_management/);
  assert.match(sql, /internal_staff_leave_annual_request/);
  assert.match(sql, /ON CONFLICT \(source_event_id\) DO NOTHING/);
  assert.doesNotMatch(sql, /decision_note/);
  assert.doesNotMatch(sql, /employee_note/);
  assert.doesNotMatch(sql, /sickness/);
});

test("all outbox kinds map to notification types", () => {
  for (const kind of STAFF_LEAVE_OUTBOX_KINDS) {
    const target = mapOutboxKindToNotificationType(kind);
    assert.ok(target.type);
    assert.ok(target.audience === "internal" || target.audience === "staff");
  }
});

test("idempotency keys are stable per audit event", () => {
  const eventId = "11111111-1111-1111-1111-111111111111";
  assert.equal(
    staffLeaveNotificationIdempotencyKey(eventId),
    "staff-leave:event:11111111-1111-1111-1111-111111111111"
  );
});

test("email metadata excludes notes and includes required leave fields", () => {
  const metadata = buildStaffLeaveEmailMetadata("management_annual_submitted", {
    requestId: "req-1",
    leaveKind: "annual",
    status: "pending",
    startDate: "2027-06-07",
    endDate: "2027-06-09",
    daysRequested: 3,
    employeeName: "Alex Example",
  });

  assert.equal(metadata.employeeName, "Alex Example");
  assert.equal(metadata.leaveType, formatLeaveKindLabel("annual"));
  assert.equal(metadata.dates, formatLeaveDateRange("2027-06-07", "2027-06-09"));
  assert.equal(metadata.daysRequested, "3 days");
  assert.equal(metadata.statusLabel, "Pending approval");
  assert.equal((metadata as Record<string, unknown>).decision_note, undefined);
  assert.equal((metadata as Record<string, unknown>).employee_note, undefined);
});

test("management recipients resolve from staff_leave_management group", () => {
  const settings = normalizeNotificationSettings({
    ...getDefaultNotificationSettings(),
    recipientGroups: {
      ...getDefaultNotificationSettings().recipientGroups,
      staff_leave_management: ["dan@example.com", "bea@example.com"],
    },
  });

  const emails = resolveInternalRecipientEmails(
    settings,
    "internal_staff_leave_annual_request"
  );

  assert.deepEqual(emails.sort(), ["bea@example.com", "dan@example.com"]);
});

test("default routing sends leave internal types to staff_leave_management", () => {
  assert.deepEqual(DEFAULT_INTERNAL_ROUTING.internal_staff_leave_annual_request, [
    "staff_leave_management",
  ]);
  assert.deepEqual(DEFAULT_INTERNAL_ROUTING.internal_staff_leave_additional_paid_request, [
    "staff_leave_management",
  ]);
  assert.deepEqual(DEFAULT_INTERNAL_ROUTING.internal_staff_leave_cancelled_approved, [
    "staff_leave_management",
  ]);
  assert.ok(INTERNAL_RECIPIENT_GROUPS.includes("staff_leave_management"));
});

test("test communication mode redirects staff and management recipients", () => {
  const previousMode = process.env.CANDID_COMMUNICATION_MODE;
  const previousRecipient = process.env.CANDID_TEST_EMAIL_RECIPIENT;
  process.env.CANDID_COMMUNICATION_MODE = "test";
  process.env.CANDID_TEST_EMAIL_RECIPIENT = "safe-inbox@example.com";

  try {
    const staff = applyEmailModeRedirect({
      intendedRecipient: "employee@example.com",
      subject: "Your leave request was approved",
    });
    const manager = applyEmailModeRedirect({
      intendedRecipient: "dan@example.com",
      subject: "Annual leave request",
    });

    assert.equal(staff.actualRecipient, "safe-inbox@example.com");
    assert.equal(manager.actualRecipient, "safe-inbox@example.com");
    assert.equal(staff.redirected, true);
    assert.equal(manager.redirected, true);
    assert.ok(staff.subject.includes("employee@example.com") || staff.redirected);
  } finally {
    if (previousMode === undefined) {
      delete process.env.CANDID_COMMUNICATION_MODE;
    } else {
      process.env.CANDID_COMMUNICATION_MODE = previousMode;
    }
    if (previousRecipient === undefined) {
      delete process.env.CANDID_TEST_EMAIL_RECIPIENT;
    } else {
      process.env.CANDID_TEST_EMAIL_RECIPIENT = previousRecipient;
    }
  }
});

test("leave API routes flush notifications after successful RPC", async () => {
  const routes = [
    "app/api/staff/leave/requests/route.ts",
    "app/api/staff/leave/additional-paid/route.ts",
    "app/api/staff/leave/requests/[id]/cancel/route.ts",
    "app/api/admin/leave/requests/route.ts",
    "app/api/admin/leave/additional-paid/route.ts",
    "app/api/admin/leave/requests/[id]/decide/route.ts",
    "app/api/admin/leave/requests/[id]/cancel/route.ts",
  ];

  for (const route of routes) {
    const source = await readFile(new URL(`../../${route}`, import.meta.url), "utf8");
    assert.match(source, /flushStaffLeaveNotifications/);
  }
});

test("cron route exists for outbox retries", async () => {
  const cron = await readFile(
    new URL("../../app/api/cron/staff-leave-notifications/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(cron, /handleStaffLeaveNotificationsCron/);
});

test("controlled cron route exists for Test-only scoped delivery", async () => {
  const cron = await readFile(
    new URL("../../app/api/cron/staff-leave-notifications/controlled/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(cron, /handleStaffLeaveControlledNotificationsCron/);
});

test("leave notification tests are registered in npm test script", async () => {
  const pkg = await readFile(new URL("../../package.json", import.meta.url), "utf8");
  assert.match(pkg, /lib\/staff-leave\/leave-notifications\.test\.ts/);
});

test("staff leave delivery gate fails closed without test safe inbox", () => {
  const prevMode = process.env.CANDID_COMMUNICATION_MODE;
  const prevRecipient = process.env.CANDID_TEST_EMAIL_RECIPIENT;
  const prevAppEnv = process.env.NEXT_PUBLIC_APP_ENV;

  process.env.NEXT_PUBLIC_APP_ENV = "test";
  process.env.CANDID_COMMUNICATION_MODE = "test";
  delete process.env.CANDID_TEST_EMAIL_RECIPIENT;

  try {
    const gate = getStaffLeaveDeliveryGate();
    assert.equal(gate.allowed, false);
    if (!gate.allowed) {
      assert.equal(gate.reason, "staff_leave_test_missing_recipient");
    }
  } finally {
    restoreEnv("CANDID_COMMUNICATION_MODE", prevMode);
    restoreEnv("CANDID_TEST_EMAIL_RECIPIENT", prevRecipient);
    restoreEnv("NEXT_PUBLIC_APP_ENV", prevAppEnv);
  }
});

test("staff leave delivery gate forces safe inbox override on Test app env", () => {
  const prevMode = process.env.CANDID_COMMUNICATION_MODE;
  const prevRecipient = process.env.CANDID_TEST_EMAIL_RECIPIENT;
  const prevAppEnv = process.env.NEXT_PUBLIC_APP_ENV;

  process.env.NEXT_PUBLIC_APP_ENV = "test";
  process.env.CANDID_COMMUNICATION_MODE = "test";
  process.env.CANDID_TEST_EMAIL_RECIPIENT = "dan@candidcreative.uk";

  try {
    const gate = getStaffLeaveDeliveryGate();
    assert.equal(gate.allowed, true);
    if (gate.allowed) {
      assert.equal(gate.recipientOverride, "dan@candidcreative.uk");
    }
  } finally {
    restoreEnv("CANDID_COMMUNICATION_MODE", prevMode);
    restoreEnv("CANDID_TEST_EMAIL_RECIPIENT", prevRecipient);
    restoreEnv("NEXT_PUBLIC_APP_ENV", prevAppEnv);
  }
});

test("internal @candidcreative.uk addresses still route to safe inbox via override", () => {
  const prevMode = process.env.CANDID_COMMUNICATION_MODE;
  const prevRecipient = process.env.CANDID_TEST_EMAIL_RECIPIENT;

  process.env.CANDID_COMMUNICATION_MODE = "test";
  process.env.CANDID_TEST_EMAIL_RECIPIENT = "dan@candidcreative.uk";

  try {
    const passthrough = applyEmailModeRedirect({
      intendedRecipient: "bea@candidcreative.uk",
      subject: "Annual leave request",
    });
    assert.equal(passthrough.actualRecipient, "bea@candidcreative.uk");
    assert.equal(passthrough.redirected, false);

    const gate = getStaffLeaveDeliveryGate();
    assert.equal(gate.allowed, true);
    if (gate.allowed) {
      assert.equal(gate.recipientOverride, "dan@candidcreative.uk");
    }
  } finally {
    restoreEnv("CANDID_COMMUNICATION_MODE", prevMode);
    restoreEnv("CANDID_TEST_EMAIL_RECIPIENT", prevRecipient);
  }
});

test("missing management recipients are not treated as successful delivery", async () => {
  const processor = await readFile(
    new URL("./notifications/process-outbox.ts", import.meta.url),
    "utf8"
  );
  assert.match(processor, /missing_internal_recipients/);
  assert.match(processor, /configurationFailure/);
  assert.doesNotMatch(
    processor,
    /missing_internal_recipients[\s\S]*softSkip/
  );
});

test("outbox claim uses conditional status update for worker races", async () => {
  const processor = await readFile(
    new URL("./notifications/process-outbox.ts", import.meta.url),
    "utf8"
  );
  assert.match(processor, /buildStaffLeaveOutboxClaimFilter/);
  assert.match(processor, /\.or\(claimFilter\)/);
  assert.match(processor, /idempotencyKey: staffLeaveNotificationIdempotencyKey/);
});

test("shared leave templates never reference sickness or private notes", async () => {
  const templates = await readFile(
    new URL("../../lib/notifications/templates.ts", import.meta.url),
    "utf8"
  );
  const metadata = await readFile(
    new URL("./notifications/build-metadata.ts", import.meta.url),
    "utf8"
  );
  const slice = templates.slice(templates.indexOf("internal_staff_leave_annual_request"));

  assert.doesNotMatch(slice, /sickness|employee_note|decision_note|grant_reason|cancellation_reason/i);
  assert.doesNotMatch(metadata, /sickness|employee_note|decision_note|grant_reason|cancellation_reason/i);
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
