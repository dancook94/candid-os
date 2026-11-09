#!/usr/bin/env node
/**
 * Cancel Stage 2 smoke Staff B pending leave requests (Test only). Uses cancel_staff_leave_request RPC
 * (audit events preserved). Pending cancel does not enqueue management email (only approved cancel does).
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const INTENDED_REQUEST_ID = "5b5b2415-1739-40f1-adee-5fed0053fe6a";
const STAFF_B_PROFILE = "458f3422-0184-4c2a-a5ae-37e5c54bf28d";
const NOTE_MATCH = "Stage2 controlled notification test";

if (!url || !anonKey || !serviceKey) {
  console.error("Missing Supabase env");
  process.exit(1);
}

const ref = url.match(/https:\/\/([^.]+)\./)?.[1] ?? "";
if (ref !== "axhkdwgmwhlbsstumndh") {
  console.error("Refuse: Test Supabase only");
  process.exit(2);
}

const adminSvc = createClient(url, serviceKey, { auth: { persistSession: false } });

async function adminSession() {
  const { data: users } = await adminSvc.auth.admin.listUsers({ perPage: 200 });
  const adminUser = users?.users?.find((u) => u.email === "dan@candidcreative.uk");
  if (!adminUser) {
    throw new Error("admin user not found");
  }
  const link = await adminSvc.auth.admin.generateLink({ type: "magiclink", email: adminUser.email });
  const otp = link.data?.properties?.email_otp;
  if (!otp) {
    throw new Error("magiclink otp missing");
  }
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.verifyOtp({
    email: adminUser.email,
    token: otp,
    type: "email",
  });
  if (error || !data.session) {
    throw error ?? new Error("admin session failed");
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

const adminClient = await adminSession();

const { data: pending, error: listError } = await adminClient
  .from("staff_leave_requests")
  .select("id, profile_id, status, start_date, employee_note, created_at")
  .eq("profile_id", STAFF_B_PROFILE)
  .eq("status", "pending")
  .ilike("employee_note", `%${NOTE_MATCH}%`);

if (listError) {
  console.error(listError);
  process.exit(1);
}

const targets = (pending ?? []).filter((r) => r.id !== INTENDED_REQUEST_ID);

console.log(
  JSON.stringify(
    { staffBProfile: STAFF_B_PROFILE, toCancel: targets.length, requests: targets },
    null,
    2
  )
);

const results = [];
for (const row of targets) {
  const { data, error } = await adminClient.rpc("cancel_staff_leave_request", {
    p_request_id: row.id,
    p_cancellation_note: "Stage 2 spare smoke cleanup — pending test submit",
  });
  results.push({
    id: row.id,
    ok: !error,
    status: data?.status,
    error: error?.message,
  });
}

const { count: outboxNew } = await adminSvc
  .from("staff_leave_notification_outbox")
  .select("id", { count: "exact", head: true })
  .in("status", ["pending", "failed", "processing"]);

console.log(JSON.stringify({ cancelResults: results, queueAfter: outboxNew }, null, 2));

const failed = results.filter((r) => !r.ok);
process.exit(failed.length > 0 ? 1 : 0);
