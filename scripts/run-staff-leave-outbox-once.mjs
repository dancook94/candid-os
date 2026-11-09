#!/usr/bin/env node
/**
 * Process pending staff leave outbox rows on Candid OS Test (service role).
 * Sets Test communication env if unset. Does not print secrets.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const requestId = process.argv[2] ?? null;

if (!url || !serviceKey) {
  console.error("Missing Supabase env");
  process.exit(1);
}

const ref = url.match(/https:\/\/([^.]+)\./)?.[1] ?? "";
if (ref !== "axhkdwgmwhlbsstumndh") {
  console.error("Refuse: not Test Supabase");
  process.exit(2);
}

process.env.CANDID_COMMUNICATION_MODE ??= "test";
process.env.CANDID_TEST_EMAIL_RECIPIENT ??= "dan@candidcreative.uk";
process.env.NEXT_PUBLIC_APP_ENV ??= "test";

const { processStaffLeaveNotificationOutbox } = await import(
  "../lib/staff-leave/notifications/process-outbox.ts"
);

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const result = await processStaffLeaveNotificationOutbox(admin, {
  ...(requestId ? { requestId } : {}),
  limit: 5,
});

console.log(JSON.stringify(result, null, 2));

const { data: outbox } = await admin
  .from("staff_leave_notification_outbox")
  .select("status, last_error, attempts, processed_at")
  .eq("request_id", requestId)
  .maybeSingle();

console.log("outbox_after", outbox);

if (requestId) {
  const { data: events } = await admin
    .from("staff_leave_request_events")
    .select("id")
    .eq("request_id", requestId)
    .eq("event_type", "submitted")
    .limit(1);
  const eventId = events?.[0]?.id;
  if (eventId) {
    const { data: notif } = await admin
      .from("notifications")
      .select(
        "notification_type, status, recipient_email, intended_recipient_email, provider_message_id, error_message"
      )
      .eq("idempotency_key", `staff-leave:event:${eventId}`);
    console.log("notifications", notif);
  }
}

process.exit(result.failed > 0 && result.sent === 0 ? 1 : 0);
