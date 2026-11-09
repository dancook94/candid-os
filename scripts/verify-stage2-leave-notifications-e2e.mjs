#!/usr/bin/env node
/**
 * Stage 2 staff leave — six notification scenarios in one run (Test only).
 *
 * Uses RPC for leave mutations (no API flush). Delivers via controlled cron on candid-os-test
 * when CRON_SECRET is set, otherwise local outbox processor (requires Resend env locally).
 *
 * Prerequisites:
 * - Migration 20270110157000 applied on Test
 * - Deploy d5fc96c+ with /api/cron/staff-leave-notifications/controlled
 * - CRON_SECRET (recommended) or local Resend + communication test env
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const E2E_SALT = "staff-leave-controlled-e2e-v1";

const TEST_REF = "axhkdwgmwhlbsstumndh";
const APP_BASE = (process.env.SMOKE_APP_URL ?? "https://candid-os-test.vercel.app").replace(
  /\/$/,
  ""
);
const SAFE_RECIPIENT = "dan@candidcreative.uk";
const RUN_NOTE_PREFIX = "Stage2 E2E notifications";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
function loadCronSecret() {
  const direct = process.env.CRON_SECRET?.trim();
  if (direct) return direct;
  const file = process.env.CRON_SECRET_FILE?.trim();
  if (!file) return "";
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

const cronSecret = loadCronSecret();

const STAFF_A = {
  email: "leave-smoke-staff-a@leave-smoke.test",
  password: "SmokeTest-Leave-Phase1!A",
};
const STAFF_B = {
  email: "leave-smoke-staff-b@leave-smoke.test",
  password: "SmokeTest-Leave-Phase1!B",
};

const SCENARIO_DEFS = [
  {
    id: 1,
    label: "Annual leave requested → management",
    kind: "management_annual_submitted",
    notificationType: "internal_staff_leave_annual_request",
    audience: "management",
    subjectIncludes: ["Annual leave request"],
  },
  {
    id: 2,
    label: "Additional Paid Leave requested → management",
    kind: "management_additional_paid_submitted",
    notificationType: "internal_staff_leave_additional_paid_request",
    audience: "management",
    subjectIncludes: ["Additional paid leave request"],
  },
  {
    id: 3,
    label: "Annual leave approved → employee",
    kind: "employee_approved",
    notificationType: "staff_leave_request_approved",
    audience: "employee",
    subjectIncludes: ["approved"],
  },
  {
    id: 4,
    label: "Annual leave declined → employee",
    kind: "employee_declined",
    notificationType: "staff_leave_request_declined",
    audience: "employee",
    subjectIncludes: ["declined"],
  },
  {
    id: 5,
    label: "Approved annual leave cancelled → management",
    kind: "management_approved_cancelled",
    notificationType: "internal_staff_leave_cancelled_approved",
    audience: "management",
    subjectIncludes: ["cancelled"],
  },
  {
    id: 6,
    label: "Additional Paid Leave granted by management → employee",
    kind: "employee_additional_paid_granted",
    notificationType: "staff_leave_additional_paid_granted",
    audience: "employee",
    subjectIncludes: ["Additional paid leave granted"],
  },
];

const results = [];
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runNote = `${RUN_NOTE_PREFIX} ${runId}`;

function record(scenarioId, pass, detail = "") {
  results.push({ scenarioId, pass, detail });
}

function isoWeekdayCandidates(year, preferred) {
  const out = [preferred];
  const start = new Date(`${year}-07-01T12:00:00.000Z`);
  const end = new Date(`${year}-10-31T12:00:00.000Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    if (!out.includes(iso)) out.push(iso);
  }
  return out;
}

async function signIn(email, password) {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { client, session: data.session, userId: data.user.id };
}

async function adminSession(adminSvc) {
  const { data: users } = await adminSvc.auth.admin.listUsers({ perPage: 200 });
  const adminUser = users?.users?.find((u) => u.email === SAFE_RECIPIENT);
  if (!adminUser) throw new Error("admin user missing");
  const link = await adminSvc.auth.admin.generateLink({ type: "magiclink", email: adminUser.email });
  const otp = link.data?.properties?.email_otp;
  if (!otp) throw new Error("magiclink otp missing");
  const otpClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await otpClient.auth.verifyOtp({
    email: adminUser.email,
    token: otp,
    type: "email",
  });
  if (error || !data.session) throw error ?? new Error("admin session failed");
  return createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

async function findBookableDay(client, profileId, year, preferred) {
  for (const iso of isoWeekdayCandidates(year, preferred)) {
    const { data, error } = await client.rpc("preview_staff_leave_request_days", {
      target_profile: profileId,
      p_start_date: iso,
      p_end_date: iso,
      p_day_portion: "full",
    });
    if (error || Number(data) <= 0) continue;
    const overlap = await client.rpc("submit_staff_leave_request", {
      p_start_date: iso,
      p_end_date: iso,
      p_day_portion: "full",
      p_employee_note: `${runNote} — probe`,
    });
    if (overlap.error && /overlap/i.test(overlap.error.message)) continue;
    if (overlap.data?.id) {
      await client.rpc("cancel_staff_leave_request", {
        p_request_id: overlap.data.id,
        p_cancellation_note: "probe rollback",
      });
    }
    return iso;
  }
  throw new Error(`No bookable weekday in ${year}`);
}

async function waitForOutbox(adminSvc, requestId, kind, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data, error } = await adminSvc
      .from("staff_leave_notification_outbox")
      .select("id, source_event_id, status, notification_kind, created_at")
      .eq("request_id", requestId)
      .eq("notification_kind", kind)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return data;
    await sleep(1500);
  }
  return null;
}

function e2eControlledBearer(serviceRoleKey) {
  return createHash("sha256").update(`${serviceRoleKey.trim()}:${E2E_SALT}`).digest("hex");
}

async function deliverOutbox(adminSvc, outboxId) {
  const useE2eAuth = !cronSecret && Boolean(serviceKey?.trim());
  const bearer = cronSecret ?? (useE2eAuth ? e2eControlledBearer(serviceKey) : "");

  if (bearer) {
    const qs = new URLSearchParams({ outboxId, ...(useE2eAuth ? { e2eAuth: "1" } : {}) });
    const res = await fetch(`${APP_BASE}/api/cron/staff-leave-notifications/controlled?${qs}`, {
      headers: {
        Authorization: `Bearer ${bearer}`,
        ...(useE2eAuth ? { "X-Staff-Leave-E2E": "1" } : {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    return {
      ok: res.ok,
      body,
      channel: useE2eAuth ? "controlled_cron_e2e_auth" : "controlled_cron",
    };
  }

  process.env.NEXT_PUBLIC_APP_ENV ??= "test";
  process.env.CANDID_COMMUNICATION_MODE ??= "test";
  process.env.CANDID_TEST_EMAIL_RECIPIENT ??= SAFE_RECIPIENT;
  const { processStaffLeaveNotificationOutbox } = await import(
    "../lib/staff-leave/notifications/process-outbox.ts"
  );
  const result = await processStaffLeaveNotificationOutbox(adminSvc, { outboxId });
  return { ok: result.sent >= 1, body: result, channel: "local_processor" };
}

async function pollNotification(adminSvc, sourceEventId, timeoutMs = 90_000) {
  const idem = `staff-leave:event:${sourceEventId}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data, error } = await adminSvc
      .from("notifications")
      .select(
        "id, notification_type, status, recipient_email, intended_recipient_email, provider_message_id, idempotency_key, metadata, subject, html_body, error_message, created_at"
      )
      .eq("idempotency_key", idem)
      .maybeSingle();
    if (error) throw error;
    if (data?.status === "sent" && data.provider_message_id) return data;
    await sleep(2000);
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatUkDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function assertNotification(scenario, notif, ctx) {
  const issues = [];
  const recipient = (notif?.recipient_email ?? "").toLowerCase();
  if (recipient !== SAFE_RECIPIENT) {
    issues.push(`recipient=${notif?.recipient_email}`);
  }
  if (notif?.notification_type !== scenario.notificationType) {
    issues.push(`type=${notif?.notification_type}`);
  }
  if (notif?.status !== "sent" || !notif?.provider_message_id) {
    issues.push("not sent or missing provider id");
  }
  for (const frag of scenario.subjectIncludes) {
    if (!String(notif?.subject ?? "").toLowerCase().includes(frag.toLowerCase())) {
      issues.push(`subject missing "${frag}"`);
    }
  }
  const meta = notif?.metadata ?? {};
  if (String(meta.employeeName ?? "") !== ctx.employeeName) {
    issues.push(`employeeName expected ${ctx.employeeName}`);
  }
  if (String(meta.dates ?? "") !== formatUkDate(ctx.startDate)) {
    issues.push(`dates expected ${formatUkDate(ctx.startDate)}`);
  }
  if (!String(meta.daysRequested ?? "").includes("1")) {
    issues.push(`days expected 1 day, got ${meta.daysRequested}`);
  }
  if (String(meta.statusLabel ?? "") !== ctx.expectedStatusLabel) {
    issues.push(`statusLabel expected ${ctx.expectedStatusLabel}`);
  }
  if (ctx.expectedLeaveType && String(meta.leaveType ?? "") !== ctx.expectedLeaveType) {
    issues.push(`leaveType expected ${ctx.expectedLeaveType}`);
  }
  const blob = JSON.stringify({ ...meta, subject: notif?.subject, html: notif?.html_body }).toLowerCase();
  if (/sickness|employee_note|decision_note|grant_reason|cancellation_reason/.test(blob)) {
    issues.push("private note/sickness leakage");
  }
  if (scenario.audience === "management") {
    if (!notif?.intended_recipient_email && !/candidcreative\.uk/.test(blob)) {
      issues.push("missing management routing context");
    }
  } else if (!notif?.intended_recipient_email?.includes("@")) {
    issues.push("missing intended employee recipient");
  }
  return issues;
}

async function preflight(adminSvc) {
  const blockers = [];

  const ref = url.match(/https:\/\/([^.]+)\./)?.[1] ?? "";
  if (ref !== TEST_REF) blockers.push(`Supabase ref ${ref} !== ${TEST_REF}`);

  const { error: migErr } = await adminSvc
    .from("staff_leave_notification_outbox")
    .select("discarded_at")
    .limit(1);
  if (migErr?.code === "42703") {
    blockers.push("Migration 20270110157000 not applied (discarded_at missing)");
  }

  const deployCheck = await fetch(
    `${APP_BASE}/api/cron/staff-leave-notifications/controlled?outboxId=00000000-0000-0000-0000-000000000001`
  );
  if (deployCheck.status === 404) {
    blockers.push("Controlled cron returns 404 — deploy not ready or not Test app env");
  } else if (deployCheck.status !== 401 && deployCheck.status !== 400 && deployCheck.status !== 503) {
    blockers.push(`Controlled cron unexpected status ${deployCheck.status}`);
  }

  const canUseE2eAuth = Boolean(serviceKey?.trim());
  if (!cronSecret && !canUseE2eAuth) {
    blockers.push(
      "CRON_SECRET or SUPABASE_SERVICE_ROLE_KEY required for controlled delivery on candid-os-test"
    );
  }

  const { count: pending } = await adminSvc
    .from("staff_leave_notification_outbox")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "failed", "processing"]);
  if ((pending ?? 0) > 0) {
    blockers.push(
      `Outbox has ${pending} claimable row(s) — drain or discard before E2E (scheduled cron may race)`
    );
  }

  return blockers;
}

async function runScenario(adminSvc, scenario, outboxRow, ctx) {
  if (!outboxRow?.id) {
    record(scenario.id, false, "outbox row missing");
    return null;
  }

  const delivery = await deliverOutbox(adminSvc, outboxRow.id);
  if (!delivery.ok) {
    record(scenario.id, false, `delivery failed: ${JSON.stringify(delivery.body).slice(0, 200)}`);
    return null;
  }

  const notif = await pollNotification(adminSvc, outboxRow.source_event_id);
  const issues = assertNotification(scenario, notif, ctx);
  const pass = issues.length === 0;
  record(
    scenario.id,
    pass,
  pass
      ? `outbox=${outboxRow.id} provider=${notif?.provider_message_id?.slice(0, 12)}… recipient=${notif?.recipient_email}`
      : issues.join("; ")
  );

  return { outboxId: outboxRow.id, notif, pass };
}

async function main() {
  if (!url || !anonKey || !serviceKey) {
    console.error("Missing Supabase env");
    process.exit(1);
  }

  const adminSvc = createClient(url, serviceKey, { auth: { persistSession: false } });

  const blockers = await preflight(adminSvc);
  if (blockers.length > 0) {
    console.error("BLOCKED — not sending emails:\n", blockers.map((b) => ` - ${b}`).join("\n"));
    console.log("\n| # | Scenario | PASS/FAIL | Outbox ID | Recipient | Delivery |");
    console.log("|---|----------|-----------|-----------|-----------|----------|");
    for (const s of SCENARIO_DEFS) {
      console.log(`| ${s.id} | ${s.label} | BLOCKED | — | — | — |`);
    }
    process.exit(2);
  }

  console.warn(
    "Note: Vercel */5 cron may still process other rows concurrently; this run only claims explicit outbox IDs."
  );

  const staffA = await signIn(STAFF_A.email, STAFF_A.password);
  const staffB = await signIn(STAFF_B.email, STAFF_B.password);
  const adminClient = await adminSession(adminSvc);

  const [{ data: profA }, { data: profB }] = await Promise.all([
    adminSvc.from("profiles").select("id, full_name").eq("id", staffA.userId).maybeSingle(),
    adminSvc.from("profiles").select("id, full_name").eq("id", staffB.userId).maybeSingle(),
  ]);
  const nameA = profA?.full_name ?? "Staff A";
  const nameB = profB?.full_name ?? "Staff B";

  const trackedEventIds = [];
  const trackedRequestIds = [];

  const ctxBase = (employeeName, startDate, statusLabel, expectedLeaveType = "Annual leave") => ({
    employeeName,
    startDate,
    expectedStatusLabel: statusLabel,
    expectedLeaveType,
  });

  // —— R1: annual submit → approve → cancel (scenarios 1, 3, 5) ——
  const dayR1 = await findBookableDay(staffB.client, staffB.userId, 2027, "2027-07-07");
  const submitR1 = await staffB.client.rpc("submit_staff_leave_request", {
    p_start_date: dayR1,
    p_end_date: dayR1,
    p_day_portion: "full",
    p_employee_note: runNote,
  });
  if (submitR1.error) throw submitR1.error;
  const r1 = submitR1.data.id;
  trackedRequestIds.push(r1);

  const ob1 = await waitForOutbox(adminSvc, r1, "management_annual_submitted");
  if (ob1) trackedEventIds.push(ob1.source_event_id);
  await runScenario(
    adminSvc,
    SCENARIO_DEFS[0],
    ob1,
    ctxBase(nameB, dayR1, "Pending approval")
  );

  const approveR1 = await adminClient.rpc("decide_staff_leave_request", {
    p_request_id: r1,
    p_decision: "approved",
    p_decision_note: runNote,
  });
  if (approveR1.error) throw approveR1.error;
  const ob3 = await waitForOutbox(adminSvc, r1, "employee_approved");
  if (ob3) trackedEventIds.push(ob3.source_event_id);
  await runScenario(adminSvc, SCENARIO_DEFS[2], ob3, ctxBase(nameB, dayR1, "Approved"));

  const cancelR1 = await adminClient.rpc("cancel_staff_leave_request", {
    p_request_id: r1,
    p_cancellation_note: `${runNote} cleanup`,
  });
  if (cancelR1.error) throw cancelR1.error;
  const ob5 = await waitForOutbox(adminSvc, r1, "management_approved_cancelled");
  if (ob5) trackedEventIds.push(ob5.source_event_id);
  await runScenario(adminSvc, SCENARIO_DEFS[4], ob5, ctxBase(nameB, dayR1, "Cancelled"));

  // —— R2: annual decline (scenario 4) ——
  const dayR2 = await findBookableDay(staffA.client, staffA.userId, 2027, "2027-08-04");
  const submitR2 = await staffA.client.rpc("submit_staff_leave_request", {
    p_start_date: dayR2,
    p_end_date: dayR2,
    p_day_portion: "full",
    p_employee_note: runNote,
  });
  if (submitR2.error) throw submitR2.error;
  const r2 = submitR2.data.id;
  trackedRequestIds.push(r2);

  const rejectR2 = await adminClient.rpc("decide_staff_leave_request", {
    p_request_id: r2,
    p_decision: "rejected",
    p_decision_note: runNote,
  });
  if (rejectR2.error) throw rejectR2.error;
  const ob4 = await waitForOutbox(adminSvc, r2, "employee_declined");
  if (ob4) trackedEventIds.push(ob4.source_event_id);
  await runScenario(adminSvc, SCENARIO_DEFS[3], ob4, ctxBase(nameA, dayR2, "Declined"));

  // —— R3: additional paid submit (scenario 2) ——
  const dayR3 = await findBookableDay(staffB.client, staffB.userId, 2027, "2027-09-01");
  const submitR3 = await staffB.client.rpc("submit_staff_additional_paid_leave_request", {
    p_start_date: dayR3,
    p_end_date: dayR3,
    p_day_portion: "full",
    p_employee_note: runNote,
  });
  if (submitR3.error) throw submitR3.error;
  const r3 = submitR3.data.id;
  trackedRequestIds.push(r3);

  const ob2 = await waitForOutbox(adminSvc, r3, "management_additional_paid_submitted");
  if (ob2) trackedEventIds.push(ob2.source_event_id);
  await runScenario(
    adminSvc,
    SCENARIO_DEFS[1],
    ob2,
    ctxBase(nameB, dayR3, "Pending approval", "Additional paid leave")
  );

  // —— R4: admin grant additional paid (scenario 6) ——
  const dayR4 = await findBookableDay(staffA.client, staffA.userId, 2027, "2027-09-15");
  const grantR4 = await adminClient.rpc("grant_staff_additional_paid_leave", {
    p_profile_id: staffA.userId,
    p_start_date: dayR4,
    p_end_date: dayR4,
    p_day_portion: "full",
    p_grant_reason: runNote,
    p_decision_note: null,
  });
  if (grantR4.error) throw grantR4.error;
  const r4 = grantR4.data.id;
  trackedRequestIds.push(r4);

  const ob6 = await waitForOutbox(adminSvc, r4, "employee_additional_paid_granted");
  if (ob6) trackedEventIds.push(ob6.source_event_id);
  await runScenario(
    adminSvc,
    SCENARIO_DEFS[5],
    ob6,
    ctxBase(nameA, dayR4, "Approved", "Additional paid leave")
  );

  // Duplicate / scope checks
  const idems = trackedEventIds.map((id) => `staff-leave:event:${id}`);
  const { data: notifs } = await adminSvc
    .from("notifications")
    .select("id, idempotency_key, recipient_email, status")
    .in("idempotency_key", idems);

  const dup =
    (notifs?.length ?? 0) > idems.length ||
    new Set(notifs?.map((n) => n.idempotency_key)).size !== idems.length;
  if (dup) {
    console.error("Duplicate notifications detected for this run.");
  }

  // Cleanup: cancel pending only (no approved-cancel email)
  const r3Status = submitR3.data?.status;
  if (r3Status === "pending") {
    await adminClient.rpc("cancel_staff_leave_request", {
      p_request_id: r3,
      p_cancellation_note: `${runNote} pending cleanup`,
    });
  }

  console.log("\n| # | Scenario | PASS/FAIL | Outbox ID | Actual recipient | Delivery |");
  console.log("|---|----------|-----------|-----------|------------------|----------|");
  for (const def of SCENARIO_DEFS) {
    const r = results.find((x) => x.scenarioId === def.id);
    const pass = r?.pass ? "PASS" : "FAIL";
    const outbox = r?.detail?.match(/outbox=([0-9a-f-]+)/)?.[1] ?? "—";
    const recipient = pass === "PASS" ? SAFE_RECIPIENT : "—";
    const delivery = pass === "PASS" ? "sent" : r?.detail ?? "—";
    console.log(`| ${def.id} | ${def.label} | ${pass} | ${outbox} | ${recipient} | ${delivery} |`);
  }

  const failed = results.filter((r) => !r.pass).length;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
