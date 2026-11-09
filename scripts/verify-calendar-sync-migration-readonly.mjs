#!/usr/bin/env node
/**
 * Read-only schema + security verification after Stage 3 calendar migrations (Test only).
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

async function main() {
  const checks = {};

  const rpc = await admin.rpc("staff_leave_calendar_claim_outbox_batch", {
    p_limit: 0,
    p_stale_before: new Date().toISOString(),
  });
  checks.claim_rpc_exists = !rpc.error || rpc.error.code !== "PGRST202";

  const outbox = await admin.from("staff_leave_calendar_sync_outbox").select("id", { count: "exact", head: true });
  checks.outbox_table = !outbox.error;
  checks.outbox_error = outbox.error?.message ?? null;

  const mappings = await admin
    .from("staff_leave_calendar_event_mappings")
    .select("id", { count: "exact", head: true });
  checks.mappings_table = !mappings.error;

  const emailOutbox = await admin
    .from("staff_leave_notification_outbox")
    .select("id", { count: "exact", head: true });
  checks.stage2_notification_outbox = !emailOutbox.error;

  const { data: calendarRows, error: calendarListError } = await admin
    .from("staff_leave_calendar_sync_outbox")
    .select("id, status, source_kind, operation, sync_provider, created_at")
    .order("created_at", { ascending: false })
    .limit(25);

  const statusCounts = {};
  if (!calendarListError) {
    for (const status of ["pending", "processing", "sent", "failed", "discarded"]) {
      const { count } = await admin
        .from("staff_leave_calendar_sync_outbox")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      statusCounts[status] = count ?? 0;
    }
  }

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

  const { count: mappingActive } = await admin
    .from("staff_leave_calendar_event_mappings")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);

  console.log(JSON.stringify({
    supabase_ref: ref,
    checks,
    calendar_outbox_counts: statusCounts,
    calendar_outbox_sent_mock: mockSent ?? 0,
    calendar_outbox_sent_google: googleSent ?? 0,
    mapping_active: mappingActive ?? 0,
    recent_calendar_outbox: calendarRows ?? [],
    claim_rpc_sample: rpc.error ? { error: rpc.error.message, code: rpc.error.code } : { returned: rpc.data },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
