#!/usr/bin/env node
/** Preflight checks before Stage 3 controlled E2E (Test only). */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const TEST_REF = "axhkdwgmwhlbsstumndh";
const APP_BASE = "https://candid-os-test.vercel.app";
const NOTE = `Stage3 preflight ${new Date().toISOString()}`;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ref = url?.match(/https:\/\/([^.]+)\./)?.[1] ?? "";
if (ref !== TEST_REF || !url || !anon || !svc) process.exit(2);

const admin = createClient(url, svc, { auth: { persistSession: false } });

async function adminClient() {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const dan = users?.users?.find((u) => u.email === "dan@candidcreative.uk");
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: dan.email });
  const otp = link.data?.properties?.email_otp;
  const otpClient = createClient(url, anon, { auth: { persistSession: false } });
  const { data } = await otpClient.auth.verifyOtp({
    email: dan.email,
    token: otp,
    type: "email",
  });
  return createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

async function main() {
  const checks = {};

  const staff = createClient(url, anon, { auth: { persistSession: false } });
  const { data: sign } = await staff.auth.signInWithPassword({
    email: "leave-smoke-staff-b@leave-smoke.test",
    password: "SmokeTest-Leave-Phase1!B",
  });
  const client = createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${sign.session.access_token}` } },
  });

  let bookable = null;
  let requestId = null;
  for (const iso of [
    "2027-07-28",
    "2027-07-29",
    "2027-07-30",
    "2027-08-02",
    "2027-08-03",
    "2027-08-04",
  ]) {
    const preview = await client.rpc("preview_staff_leave_request_days", {
      target_profile: sign.user.id,
      p_start_date: iso,
      p_end_date: iso,
      p_day_portion: "full",
    });
    if ((preview.data ?? 0) <= 0) continue;

    const sub = await client.rpc("submit_staff_leave_request", {
      p_start_date: iso,
      p_end_date: iso,
      p_day_portion: "full",
      p_employee_note: NOTE,
    });
    if (!sub.error && sub.data?.id) {
      bookable = iso;
      requestId = sub.data.id;
      break;
    }
    if (/overlap|insufficient|balance|bookable working days/i.test(sub.error?.message ?? "")) {
      continue;
    }
    throw sub.error;
  }
  if (!requestId) {
    console.log(JSON.stringify({ ok: false, error: "no_bookable_date" }));
    process.exit(1);
  }
  checks.submit_ok = true;

  const ac = await adminClient();
  const approve = await ac.rpc("decide_staff_leave_request", {
    p_request_id: requestId,
    p_decision: "approved",
    p_decision_note: NOTE,
  });
  checks.approve_no_42p10 = !approve.error;
  checks.approve_error = approve.error?.message ?? null;

  await new Promise((r) => setTimeout(r, 1500));

  const { data: calRows } = await admin
    .from("staff_leave_calendar_sync_outbox")
    .select("id, operation, source_kind, status")
    .eq("leave_request_id", requestId);
  checks.calendar_outbox_rows = calRows?.length ?? 0;
  checks.calendar_upsert_pending =
    calRows?.some((r) => r.operation === "upsert" && r.source_kind === "leave_approved") ?? false;

  const { data: emailRows } = await admin
    .from("staff_leave_notification_outbox")
    .select("id, notification_kind, status")
    .eq("request_id", requestId);
  checks.notification_outbox_rows = emailRows?.length ?? 0;
  checks.stage2_employee_approved =
    emailRows?.some((r) => r.notification_kind === "employee_approved") ?? false;

  const calId = calRows?.find((r) => r.operation === "upsert")?.id;
  if (calId) {
    const bearer = createHash("sha256")
      .update(`${svc.trim()}:staff-leave-calendar-controlled-e2e-v1`)
      .digest("hex");
    const res = await fetch(
      `${APP_BASE}/api/cron/staff-leave-calendar-sync/controlled?outboxId=${calId}&e2eAuth=1`,
      { headers: { Authorization: `Bearer ${bearer}`, "X-Staff-Leave-E2E": "1" } }
    );
    const body = await res.json().catch(() => ({}));
    checks.controlled_deliver_ok = res.ok && body?.ok;
    checks.controlled_body = body;
  }

  const allOk =
    checks.approve_no_42p10 &&
    checks.calendar_upsert_pending &&
    checks.stage2_employee_approved;

  console.log(JSON.stringify({ ok: allOk, bookable, requestId, checks }, null, 2));
  process.exitCode = allOk ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
