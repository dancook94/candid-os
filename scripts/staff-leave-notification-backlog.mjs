#!/usr/bin/env node
/**
 * List or discard obsolete Test staff-leave notification outbox rows (audit notifications are kept).
 *
 * Usage:
 *   node scripts/staff-leave-notification-backlog.mjs list [--status pending,failed]
 *   node scripts/staff-leave-notification-backlog.mjs discard --outbox-id UUID [--reason "..."] [--dry-run]
 *   node scripts/staff-leave-notification-backlog.mjs discard --request-id UUID [--reason "..."] [--dry-run]
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const ref = url.match(/https:\/\/([^.]+)\./)?.[1] ?? "";
if (ref !== "axhkdwgmwhlbsstumndh") {
  console.error("Refuse: staff-leave notification backlog tools are Test-only (axhkdwgmwhlbsstumndh).");
  process.exit(2);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const cmd = args[0];

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const DISCARDABLE = ["pending", "failed", "processing"];

async function listBacklog() {
  const statusArg = argValue("--status");
  const statuses = statusArg ? statusArg.split(",").map((s) => s.trim()) : [...DISCARDABLE, "discarded"];

  const { data, error } = await admin
    .from("staff_leave_notification_outbox")
    .select(
      "id, request_id, source_event_id, notification_kind, status, attempts, created_at, discard_reason, discarded_at, last_error"
    )
    .in("status", statuses)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    console.error(error);
    process.exit(1);
  }

  console.log(JSON.stringify({ count: data?.length ?? 0, rows: data }, null, 2));
}

async function discardBacklog() {
  const outboxId = argValue("--outbox-id");
  const requestId = argValue("--request-id");
  const reason =
    argValue("--reason")?.trim() ||
    "Obsolete Test notification backlog — discarded without deleting notifications audit.";
  const dryRun = args.includes("--dry-run");

  if (!outboxId && !requestId) {
    console.error("Provide --outbox-id or --request-id");
    process.exit(1);
  }

  let query = admin
    .from("staff_leave_notification_outbox")
    .select("id, request_id, status, notification_kind, created_at")
    .in("status", DISCARDABLE);

  if (outboxId) {
    query = query.eq("id", outboxId);
  }
  if (requestId) {
    query = query.eq("request_id", requestId);
  }

  const { data: rows, error } = await query;

  if (error) {
    console.error(error);
    process.exit(1);
  }

  if (!rows?.length) {
    console.log(JSON.stringify({ matched: 0, discarded: 0, dryRun }, null, 2));
    return;
  }

  const sent = rows.filter((r) => r.status === "sent");
  if (sent.length > 0) {
    console.error("Refuse: cannot discard sent outbox rows (audit retained).", sent);
    process.exit(3);
  }

  if (dryRun) {
    console.log(JSON.stringify({ matched: rows.length, discarded: 0, dryRun: true, rows }, null, 2));
    return;
  }

  const now = new Date().toISOString();
  const ids = rows.map((r) => r.id);

  const { error: updateError } = await admin
    .from("staff_leave_notification_outbox")
    .update({
      status: "discarded",
      discarded_at: now,
      discard_reason: reason,
      locked_at: null,
      processed_at: now,
      last_error: null,
    })
    .in("id", ids)
    .in("status", DISCARDABLE);

  if (updateError) {
    console.error(updateError);
    process.exit(1);
  }

  console.log(JSON.stringify({ matched: rows.length, discarded: rows.length, dryRun: false, rows }, null, 2));
}

if (cmd === "list") {
  await listBacklog();
} else if (cmd === "discard") {
  await discardBacklog();
} else {
  console.error("Usage: list | discard");
  process.exit(1);
}
