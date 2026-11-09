#!/usr/bin/env node
/**
 * Stage 3 calendar sync — controlled mock scenarios (Test only, axhkdwgmwhlbsstumndh).
 * Does not invoke staff leave notification cron (no email delivery).
 */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const E2E_SALT = "staff-leave-controlled-e2e-v1";
const TEST_REF = "axhkdwgmwhlbsstumndh";
const RUN_NOTE_PREFIX = "Stage3 E2E calendar";
const APP_BASE = (process.env.SMOKE_APP_URL ?? "https://candid-os-test.vercel.app").replace(
  /\/$/,
  ""
);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.CRON_SECRET?.trim() ?? "";

const ref = url?.match(/https:\/\/([^.]+)\./)?.[1] ?? "";
if (ref !== TEST_REF) {
  console.error(`Refuse: expected ${TEST_REF}, got ${ref || "(unset)"}`);
  process.exit(2);
}
if (!url || !anonKey || !serviceKey) {
  console.error("Missing Supabase env");
  process.exit(2);
}

const adminSvc = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runNote = `${RUN_NOTE_PREFIX} ${runId}`;
const results = [];

const STAFF_B = {
  email: "leave-smoke-staff-b@leave-smoke.test",
  password: "SmokeTest-Leave-Phase1!B",
};
const STAFF_A = {
  email: "leave-smoke-staff-a@leave-smoke.test",
  password: "SmokeTest-Leave-Phase1!A",
};

function record(id, label, pass, detail = "") {
  results.push({ id, label, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} [${id}] ${label}${detail ? ` — ${detail}` : ""}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isoWeekdayCandidates(year, preferred) {
  const out = [preferred];
  const start = new Date(`${year}-08-01T12:00:00.000Z`);
  const end = new Date(`${year}-10-31T12:00:00.000Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    if (!out.includes(iso)) out.push(iso);
  }
  return out;
}

function e2eControlledBearer(serviceRoleKey) {
  return createHash("sha256").update(`${serviceRoleKey.trim()}:${E2E_SALT}`).digest("hex");
}

async function signIn(email, password) {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { client, userId: data.user.id };
}

let adminAccessToken = "";

async function adminSession() {
  const { data: users } = await adminSvc.auth.admin.listUsers({ perPage: 200 });
  const adminUser = users?.users?.find((u) => u.email === "dan@candidcreative.uk");
  if (!adminUser) throw new Error("admin dan@candidcreative.uk missing");
  const link = await adminSvc.auth.admin.generateLink({
    type: "magiclink",
    email: adminUser.email,
  });
  const otp = link.data?.properties?.email_otp;
  if (!otp) throw new Error("magiclink otp missing");
  const otpClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await otpClient.auth.verifyOtp({
    email: adminUser.email,
    token: otp,
    type: "email",
  });
  if (error || !data.session) throw error ?? new Error("admin session failed");
  adminAccessToken = data.session.access_token;
  return createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

async function submitOnFirstAvailableDay(client, profileId, submitArgs, year, preferred) {
  const portion = submitArgs.args.p_day_portion ?? "full";
  for (const iso of isoWeekdayCandidates(year, preferred)) {
    const preview = await client.rpc("preview_staff_leave_request_days", {
      target_profile: profileId,
      p_start_date: iso,
      p_end_date: iso,
      p_day_portion: portion,
    });
    if (preview.error || Number(preview.data) <= 0) continue;
    const attempt = await client.rpc(submitArgs.fn, {
      ...submitArgs.args,
      p_start_date: iso,
      p_end_date: iso,
    });
    if (!attempt.error && attempt.data?.id) {
      return { iso, data: attempt.data };
    }
    if (/overlap|insufficient|balance|bookable working days/i.test(attempt.error?.message ?? "")) {
      continue;
    }
    throw attempt.error ?? new Error("submit failed");
  }
  throw new Error(`No bookable weekday in ${year}`);
}

async function waitForCalendarOutbox(where, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let q = adminSvc
      .from("staff_leave_calendar_sync_outbox")
      .select("id, status, operation, source_kind, calendar_channel, leave_request_id, sickness_id")
      .order("created_at", { ascending: false })
      .limit(1);
    for (const [key, val] of Object.entries(where)) {
      q = q.eq(key, val);
    }
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    if (data?.id) return data;
    await sleep(800);
  }
  return null;
}

async function deliverCalendarOutbox(outboxId) {
  const useE2eAuth = !cronSecret;
  const bearer = cronSecret || (useE2eAuth ? e2eControlledBearer(serviceKey) : "");
  if (!bearer) {
    return { ok: false, body: { error: "no_delivery_credentials" } };
  }
  const qs = new URLSearchParams({ outboxId, ...(useE2eAuth ? { e2eAuth: "1" } : {}) });
  const res = await fetch(`${APP_BASE}/api/cron/staff-leave-calendar-sync/controlled?${qs}`, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      ...(useE2eAuth ? { "X-Staff-Leave-E2E": "1" } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && body?.ok !== false, status: res.status, body };
}

async function refreshOutbox(outboxId) {
  const { data, error } = await adminSvc
    .from("staff_leave_calendar_sync_outbox")
    .select("*")
    .eq("id", outboxId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function activeMapping(entityType, entityId, channel = null) {
  let q = adminSvc
    .from("staff_leave_calendar_event_mappings")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId);
  if (channel) q = q.eq("calendar_channel", channel);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data;
}

async function countMappings() {
  const { count, error } = await adminSvc
    .from("staff_leave_calendar_event_mappings")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);
  if (error) throw error;
  return count ?? 0;
}

async function reconcileDryRun() {
  const res = await fetch(`${APP_BASE}/api/admin/leave/calendar-sync/reconcile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminAccessToken}`,
    },
    body: JSON.stringify({ dryRun: true, includeGoogleRefresh: true }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function main() {
  const comm = process.env.CANDID_COMMUNICATION_MODE?.trim() ?? "";
  console.log(`Run note: ${runNote}`);
  console.log(`CANDID_COMMUNICATION_MODE=${comm || "(unset)"}`);
  console.log(`Notification cron will NOT be invoked.`);

  const staffB = await signIn(STAFF_B.email, STAFF_B.password);
  const staffA = await signIn(STAFF_A.email, STAFF_A.password);
  const adminClient = await adminSession();

  await adminSvc.from("profiles").update({ full_name: "Leave Smoke Staff B" }).eq("id", staffB.userId);
  await adminSvc.from("profiles").update({ full_name: "Leave Smoke Staff A" }).eq("id", staffA.userId);

  // —— 1. Approve annual → mock upsert ——
  const s1 = await submitOnFirstAvailableDay(
    staffB.client,
    staffB.userId,
    { fn: "submit_staff_leave_request", args: { p_day_portion: "full", p_employee_note: runNote } },
    2027,
    "2027-06-07"
  );
  const r1 = s1.data.id;
  await adminClient.rpc("decide_staff_leave_request", {
    p_request_id: r1,
    p_decision: "approved",
    p_decision_note: runNote,
  });
  const ob1 = await waitForCalendarOutbox({
    leave_request_id: r1,
    operation: "upsert",
    source_kind: "leave_approved",
  });
  const d1 = ob1 ? await deliverCalendarOutbox(ob1.id) : null;
  const m1 = await activeMapping("leave_request", r1, "team_leave");
  record(
    1,
    "Approve annual leave → mock upsert",
    Boolean(
      ob1 &&
        d1?.ok &&
        (await refreshOutbox(ob1.id))?.status === "sent" &&
        m1?.sync_provider === "mock" &&
        !m1?.deleted_at
    ),
    `outbox=${ob1?.id ?? "—"} channel=${m1?.calendar_channel ?? "—"}`
  );

  // —— 2. Cancel approved → mock delete ——
  await adminClient.rpc("cancel_staff_leave_request", {
    p_request_id: r1,
    p_cancellation_note: `${runNote} cancel`,
  });
  const ob2 = await waitForCalendarOutbox({
    leave_request_id: r1,
    operation: "delete",
    source_kind: "leave_cancelled_approved",
  });
  const d2 = ob2 ? await deliverCalendarOutbox(ob2.id) : null;
  const m1b = await activeMapping("leave_request", r1, "team_leave");
  record(
    2,
    "Cancel approved leave → mock delete",
    Boolean(d2?.ok && (await refreshOutbox(ob2.id))?.status === "sent" && m1b?.deleted_at),
    `mapping_deleted_at=${m1b?.deleted_at ?? "—"}`
  );

  // —— 3. Grant additional paid → mock upsert ——
  let r3 = null;
  for (const iso of isoWeekdayCandidates(2027, "2027-06-14")) {
    const grant = await adminClient.rpc("grant_staff_additional_paid_leave", {
      p_profile_id: staffA.userId,
      p_start_date: iso,
      p_end_date: iso,
      p_day_portion: "full",
      p_grant_reason: runNote,
      p_decision_note: null,
    });
    if (!grant.error && grant.data?.id) {
      r3 = grant.data.id;
      break;
    }
    if (/overlap|insufficient|balance/i.test(grant.error?.message ?? "")) continue;
    throw grant.error;
  }
  const ob3 = r3
    ? await waitForCalendarOutbox({
        leave_request_id: r3,
        operation: "upsert",
        source_kind: "leave_approved",
      })
    : null;
  const d3 = ob3 ? await deliverCalendarOutbox(ob3.id) : null;
  const m3 = r3 ? await activeMapping("leave_request", r3, "team_leave") : null;
  record(
    3,
    "Grant Additional Paid Leave → mock upsert",
    Boolean(d3?.ok && m3?.sync_provider === "mock" && !m3?.deleted_at),
    `request=${r3 ?? "—"}`
  );

  // —— 4. Sickness → sickness_management only ——
  let sicknessId = null;
  for (const iso of isoWeekdayCandidates(2027, "2027-06-15")) {
    const sick = await adminClient.rpc("record_staff_absence_sickness", {
      p_profile_id: staffB.userId,
      p_start_date: iso,
      p_end_date: iso,
      p_day_portion: "full",
      p_reason: runNote,
      p_note: runNote,
      p_private_note: `${runNote} private`,
    });
    if (!sick.error && sick.data?.id) {
      sicknessId = sick.data.id;
      break;
    }
    if (/overlap/i.test(sick.error?.message ?? "")) continue;
    throw sick.error;
  }
  const ob4 = sicknessId
    ? await waitForCalendarOutbox({ sickness_id: sicknessId, operation: "upsert" })
    : null;
  const d4 = ob4 ? await deliverCalendarOutbox(ob4.id) : null;
  const m4 = sicknessId ? await activeMapping("sickness", sicknessId, "sickness_management") : null;
  const m4team = sicknessId ? await activeMapping("sickness", sicknessId, "team_leave") : null;
  record(
    4,
    "Record sickness → sickness_management only",
    Boolean(
      d4?.ok &&
        ob4?.calendar_channel === "sickness_management" &&
        m4?.sync_provider === "mock" &&
        !m4team
    ),
    `sickness=${sicknessId ?? "—"}`
  );

  // —— 5. AM / PM half-days ——
  const am = await submitOnFirstAvailableDay(
    staffB.client,
    staffB.userId,
    { fn: "submit_staff_leave_request", args: { p_day_portion: "am", p_employee_note: runNote } },
    2027,
    "2027-06-08"
  );
  await adminClient.rpc("decide_staff_leave_request", {
    p_request_id: am.data.id,
    p_decision: "approved",
    p_decision_note: runNote,
  });
  const obAm = await waitForCalendarOutbox({ leave_request_id: am.data.id, operation: "upsert" });
  await deliverCalendarOutbox(obAm.id);
  const { data: amReq } = await adminSvc
    .from("staff_leave_requests")
    .select("day_portion,start_date")
    .eq("id", am.data.id)
    .single();

  const pm = await submitOnFirstAvailableDay(
    staffB.client,
    staffB.userId,
    { fn: "submit_staff_leave_request", args: { p_day_portion: "pm", p_employee_note: runNote } },
    2027,
    "2027-06-09"
  );
  await adminClient.rpc("decide_staff_leave_request", {
    p_request_id: pm.data.id,
    p_decision: "approved",
    p_decision_note: runNote,
  });
  const obPm = await waitForCalendarOutbox({ leave_request_id: pm.data.id, operation: "upsert" });
  await deliverCalendarOutbox(obPm.id);
  const { data: pmReq } = await adminSvc
    .from("staff_leave_requests")
    .select("day_portion,start_date")
    .eq("id", pm.data.id)
    .single();
  const mAm = await activeMapping("leave_request", am.data.id, "team_leave");
  const mPm = await activeMapping("leave_request", pm.data.id, "team_leave");
  record(
    5,
    "AM and PM half-days → distinct mock mappings",
    Boolean(
      amReq?.day_portion === "am" &&
        pmReq?.day_portion === "pm" &&
        mAm?.content_fingerprint &&
        mPm?.content_fingerprint &&
        mAm.content_fingerprint !== mPm.content_fingerprint
    ),
    `am_fp=${mAm?.content_fingerprint?.slice(0, 12)} pm_fp=${mPm?.content_fingerprint?.slice(0, 12)}`
  );

  // —— 6. Duplicate processing ——
  const beforeMaps = await countMappings();
  const dupA = await deliverCalendarOutbox(obAm.id);
  const dupB = await deliverCalendarOutbox(obAm.id);
  const afterMaps = await countMappings();
  record(
    6,
    "Duplicate processing → no duplicate mappings",
    Boolean(dupA?.ok && dupB?.ok && afterMaps === beforeMaps),
    `active_mappings=${afterMaps}`
  );

  // —— 7. Stale upsert after cancellation ——
  const s7 = await submitOnFirstAvailableDay(
    staffB.client,
    staffB.userId,
    { fn: "submit_staff_leave_request", args: { p_day_portion: "full", p_employee_note: runNote } },
    2027,
    "2027-06-16"
  );
  await adminClient.rpc("decide_staff_leave_request", {
    p_request_id: s7.data.id,
    p_decision: "approved",
    p_decision_note: runNote,
  });
  await adminClient.rpc("cancel_staff_leave_request", {
    p_request_id: s7.data.id,
    p_cancellation_note: runNote,
  });
  const ob7del = await waitForCalendarOutbox({
    leave_request_id: s7.data.id,
    operation: "delete",
  });
  const ob7up = await waitForCalendarOutbox({
    leave_request_id: s7.data.id,
    operation: "upsert",
  });
  await deliverCalendarOutbox(ob7del.id);
  const upResult = await deliverCalendarOutbox(ob7up.id);
  const ob7upAfter = await refreshOutbox(ob7up.id);
  record(
    7,
    "Stale approved upsert after cancel → discarded",
    Boolean(
      (await refreshOutbox(ob7del.id))?.status === "sent" &&
        (ob7upAfter?.status === "discarded" || upResult?.body?.discarded === 1)
    ),
    `upsert_status=${ob7upAfter?.status} discard=${ob7upAfter?.discard_reason ?? "—"}`
  );

  // —— 8. Reconciliation ——
  if (m3?.id) {
    await adminSvc
      .from("staff_leave_calendar_event_mappings")
      .update({ content_fingerprint: "stale-fingerprint-stage3-e2e" })
      .eq("id", m3.id);
  }
  const recon = await reconcileDryRun();
  const findings = recon.body?.scan?.findings ?? [];
  const outdated = findings.some((f) => f.kind === "outdated_team_leave_mapping" && f.entityId === r3);
  record(
    8,
    "Reconciliation detects stale mapping",
    Boolean(recon.ok && outdated),
    `findings=${findings.length}`
  );

  // —— 9. Concurrent entity guard (RPC) ——
  const s9 = await submitOnFirstAvailableDay(
    staffB.client,
    staffB.userId,
    { fn: "submit_staff_leave_request", args: { p_day_portion: "full", p_employee_note: runNote } },
    2027,
    "2027-06-17"
  );
  await adminClient.rpc("decide_staff_leave_request", {
    p_request_id: s9.data.id,
    p_decision: "approved",
    p_decision_note: runNote,
  });
  await adminClient.rpc("cancel_staff_leave_request", {
    p_request_id: s9.data.id,
    p_cancellation_note: runNote,
  });
  const pending9 = await adminSvc
    .from("staff_leave_calendar_sync_outbox")
    .select("id, operation, status")
    .eq("leave_request_id", s9.data.id)
    .eq("status", "pending");
  const ids9 = (pending9.data ?? []).map((r) => r.id);
  const claimA = await adminSvc.rpc("staff_leave_calendar_claim_outbox_batch", {
    p_limit: 2,
    p_stale_before: new Date().toISOString(),
  });
  const claimedSet = new Set(claimA.data ?? []);
  const bothClaimed =
    ids9.length >= 2 && ids9.every((id) => claimedSet.has(id)) && claimedSet.size >= 2;
  record(
    9,
    "Concurrent processing guard on same entity",
    Boolean(!bothClaimed && (claimA.data?.length ?? 0) <= 1),
    `pending=${ids9.length} claimed=${claimA.data?.length ?? 0}`
  );

  // —— 10. Mock → Google transition detection ——
  const mockFinding = findings.some((f) => f.kind === "mock_needs_google_sync");
  record(
    10,
    "Mock-to-Google transition detection",
    Boolean(recon.ok && mockFinding),
    `mock_needs_google_sync=${mockFinding}`
  );

  // Notification health (read-only)
  const notifCounts = {};
  for (const status of ["pending", "processing", "sent", "failed", "discarded"]) {
    const { count } = await adminSvc
      .from("staff_leave_notification_outbox")
      .select("id", { count: "exact", head: true })
      .eq("status", status);
    notifCounts[status] = count ?? 0;
  }

  const calCounts = {};
  for (const status of ["pending", "processing", "sent", "failed", "discarded"]) {
    const { count } = await adminSvc
      .from("staff_leave_calendar_sync_outbox")
      .select("id", { count: "exact", head: true })
      .eq("status", status);
    calCounts[status] = count ?? 0;
  }

  console.log("\n--- Summary table ---");
  console.log("| # | Scenario | PASS/FAIL | Detail |");
  for (const r of results) {
    console.log(`| ${r.id} | ${r.label} | ${r.pass ? "PASS" : "FAIL"} | ${r.detail} |`);
  }
  console.log("\nCalendar outbox counts:", calCounts);
  console.log("Notification outbox counts:", notifCounts);
  console.log("(E2E rows tagged with employee/grant notes containing run id)");

  const failed = results.filter((r) => !r.pass).length;
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
