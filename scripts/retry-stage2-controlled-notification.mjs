#!/usr/bin/env node
/**
 * Retry the Stage 2 controlled annual-leave notification (no new leave request).
 * Requires: Test Supabase env, migration 156000 applied, optional CRON_SECRET for cron flush.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appBase = (process.env.SMOKE_APP_URL ?? "https://candid-os-test.vercel.app").replace(
  /\/$/,
  ""
);

const REQUEST_ID = "5b5b2415-1739-40f1-adee-5fed0053fe6a";
const OUTBOX_ID = "3a646321-3c69-4e67-9bc7-9d79532c9475";
const EVENT_ID = "bffd06a0-a57b-4b88-92d0-9171e70b65bf";
const IDEM = `staff-leave:event:${EVENT_ID}`;

if (!url || !serviceKey) {
  console.error("Missing Supabase env");
  process.exit(1);
}

const ref = url.match(/https:\/\/([^.]+)\./)?.[1] ?? "";
if (ref !== "axhkdwgmwhlbsstumndh") {
  console.error("Refuse: not Test Supabase");
  process.exit(2);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

function record(name, pass, detail = "") {
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
  return pass;
}

const { error: grantProbe } = await admin
  .from("staff_leave_requests")
  .select("id")
  .eq("id", REQUEST_ID)
  .maybeSingle();
const grantsOk = !grantProbe;
record(
  "service_role can SELECT staff_leave_requests (migration 156000)",
  grantsOk,
  grantProbe?.code === "42501" ? "permission denied — apply 156000 first" : grantProbe?.message ?? "ok"
);

if (!grantsOk) {
  process.exit(1);
}

const { data: outboxBefore } = await admin
  .from("staff_leave_notification_outbox")
  .select("status")
  .eq("id", OUTBOX_ID)
  .maybeSingle();

if (outboxBefore?.status === "processing" || outboxBefore?.status === "failed") {
  await admin
    .from("staff_leave_notification_outbox")
    .update({ status: "pending", locked_at: null, last_error: null })
    .eq("id", OUTBOX_ID);
  record("Outbox reset to pending for single retry", true, `was ${outboxBefore.status}`);
}

const { data: settings } = await admin
  .from("notification_settings")
  .select("settings")
  .eq("singleton_key", "default")
  .maybeSingle();
const mgmt = settings?.settings?.recipientGroups?.staff_leave_management ?? [];
record(
  "Management recipients configured",
  mgmt.includes("dan@candidcreative.uk") && mgmt.includes("bea@candidcreative.uk"),
  mgmt.join(", ")
);

const cronSecret = process.env.CRON_SECRET?.trim();
if (cronSecret) {
  const res = await fetch(`${appBase}/api/cron/staff-leave-notifications`, {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  const body = await res.json().catch(() => ({}));
  record("Cron flush invoked", res.ok, `HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
} else {
  console.log("SKIP: CRON_SECRET not set — invoking local processor");
  process.env.CANDID_COMMUNICATION_MODE ??= "test";
  process.env.CANDID_TEST_EMAIL_RECIPIENT ??= "dan@candidcreative.uk";
  process.env.NEXT_PUBLIC_APP_ENV ??= "test";
  const { processStaffLeaveNotificationOutbox } = await import(
    "../lib/staff-leave/notifications/process-outbox.ts"
  );
  const result = await processStaffLeaveNotificationOutbox(admin, { requestId: REQUEST_ID });
  record("Local outbox processor", result.sent >= 1 || result.failed === 0, JSON.stringify(result));
}

await new Promise((r) => setTimeout(r, 2000));

const { data: outbox } = await admin
  .from("staff_leave_notification_outbox")
  .select("status, attempts, last_error, processed_at")
  .eq("id", OUTBOX_ID)
  .maybeSingle();

const { data: notifs } = await admin
  .from("notifications")
  .select(
    "id, notification_type, status, recipient_email, intended_recipient_email, provider_message_id, idempotency_key, metadata, subject, error_message"
  )
  .eq("idempotency_key", IDEM);

const notif = notifs?.[0];
const allForIdem = notifs?.length ?? 0;

record("Outbox status is sent", outbox?.status === "sent", JSON.stringify(outbox));
record(
  "Resend accepted + provider message id",
  notif?.status === "sent" && Boolean(notif?.provider_message_id),
  `status=${notif?.status} provider=${notif?.provider_message_id ? "present" : "missing"} err=${notif?.error_message ?? ""}`
);
record(
  "Actual recipient exclusively dan@candidcreative.uk",
  (notif?.recipient_email ?? "").toLowerCase() === "dan@candidcreative.uk",
  notif?.recipient_email ?? ""
);
record(
  "No duplicate notifications for idempotency key",
  allForIdem <= 1,
  `count=${allForIdem}`
);
record(
  "Notification type",
  notif?.notification_type === "internal_staff_leave_annual_request",
  notif?.notification_type ?? ""
);

const metaStr = JSON.stringify(notif?.metadata ?? {}).toLowerCase();
record(
  "Intended management context in metadata/subject",
  metaStr.includes("employee") || (notif?.subject ?? "").toLowerCase().includes("annual"),
  (notif?.subject ?? "").slice(0, 100)
);

process.exit(outbox?.status === "sent" && notif?.provider_message_id ? 0 : 1);
