#!/usr/bin/env node
/**
 * Read-only calendar sync / migration probe for Candid OS Test (axhkdwgmwhlbsstumndh).
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ref = url?.match(/https:\/\/([^.]+)\./)?.[1] ?? "";

if (ref !== "axhkdwgmwhlbsstumndh") {
  console.error(`Refuse: expected axhkdwgmwhlbsstumndh, got ${ref || "(unset)"}`);
  process.exit(2);
}

if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required.");
  process.exit(2);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

async function countByStatus(table) {
  const statuses = ["pending", "processing", "sent", "failed", "discarded"];
  const counts = {};
  for (const status of statuses) {
    const { count, error } = await admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("status", status);
    if (error) throw error;
    counts[status] = count ?? 0;
  }
  return counts;
}

async function main() {
  const outboxProbe = await admin.from("staff_leave_calendar_sync_outbox").select("id", { count: "exact", head: true });
  const mappingProbe = await admin.from("staff_leave_calendar_event_mappings").select("id", { count: "exact", head: true });

  console.log("--- Calendar migration probe (Test) ---");
  if (outboxProbe.error) {
    console.log(`staff_leave_calendar_sync_outbox: MISSING (${outboxProbe.error.code})`);
  } else {
    const counts = await countByStatus("staff_leave_calendar_sync_outbox");
    const { count: mockSent } = await admin
      .from("staff_leave_calendar_sync_outbox")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent")
      .eq("sync_provider", "mock");
    const { count: googleSent } = await admin
      .from("staff_leave_calendar_sync_outbox")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent")
      .eq("sync_provider", "google");

    console.log("staff_leave_calendar_sync_outbox:", counts);
    console.log(`  sent.mock=${mockSent ?? 0} sent.google=${googleSent ?? 0}`);

    const { data: recent } = await admin
      .from("staff_leave_calendar_sync_outbox")
      .select("id, status, source_kind, operation, created_at, sync_provider")
      .order("created_at", { ascending: false })
      .limit(15);
    console.log("recent outbox:", recent ?? []);
  }

  if (mappingProbe.error) {
    console.log(`staff_leave_calendar_event_mappings: MISSING (${mappingProbe.error.code})`);
  } else {
    const { count: active } = await admin
      .from("staff_leave_calendar_event_mappings")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null);
    console.log(`staff_leave_calendar_event_mappings active=${active ?? 0}`);
  }

  const { count: emailTriggerProbe } = await admin
    .from("staff_leave_notification_outbox")
    .select("id", { count: "exact", head: true });
  console.log(`staff_leave_notification_outbox reachable=${emailTriggerProbe != null}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
