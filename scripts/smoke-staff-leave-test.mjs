#!/usr/bin/env node
/**
 * Smoke tests for Staff Holiday Phase 1+2 on Candid OS Test only.
 * Uses ephemeral @leave-smoke.test users; does not send customer emails.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appBase = (process.env.SMOKE_APP_URL ?? "https://candid-os-test.vercel.app").replace(
  /\/$/,
  ""
);

if (!url || !anonKey || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

const ref = url.match(/https:\/\/([^.]+)\./)?.[1] ?? "";
const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const STAFF_A = {
  email: "leave-smoke-staff-a@leave-smoke.test",
  password: "SmokeTest-Leave-Phase1!A",
  role: "sales",
};
const STAFF_B = {
  email: "leave-smoke-staff-b@leave-smoke.test",
  password: "SmokeTest-Leave-Phase1!B",
  role: "production",
};

const results = [];

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

async function ensureStaffUser(spec) {
  const { data: listed } = await admin.auth.admin.listUsers({ perPage: 200 });
  let user = listed?.users?.find((u) => u.email === spec.email);

  if (!user) {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: spec.email,
      password: spec.password,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser ${spec.email}: ${error.message}`);
    user = created.user;
  } else {
    await admin.auth.admin.updateUserById(user.id, {
      password: spec.password,
      email_confirm: true,
    });
  }

  const { error: profileError } = await admin.from("profiles").upsert(
    {
      id: user.id,
      user_role: spec.role,
      account_status: "approved",
    },
    { onConflict: "id" }
  );

  if (profileError) {
    throw new Error(`profile upsert ${spec.email}: ${profileError.message}`);
  }

  return user.id;
}

async function signIn(email, password) {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return { client, session: data.session, userId: data.user.id };
}

async function rpc(client, fn, args) {
  return client.rpc(fn, args);
}

async function apiGet(path, accessToken) {
  const res = await fetch(`${appBase}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function apiPost(path, accessToken, json) {
  const res = await fetch(`${appBase}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(json),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function cleanupRequest(adminClient, requestId) {
  if (!requestId) return;
  await adminClient.from("staff_leave_request_events").delete().eq("request_id", requestId);
  await adminClient.from("staff_leave_requests").delete().eq("id", requestId);
}

async function cleanupSickness(adminClient, sicknessId) {
  if (!sicknessId) return;
  await adminClient.from("staff_absence_sickness").delete().eq("id", sicknessId);
}

function isoDateUtc(d) {
  return d.toISOString().slice(0, 10);
}

function eachCalendarDay(startIso, endIso) {
  const days = [];
  const cursor = new Date(`${startIso}T12:00:00.000Z`);
  const end = new Date(`${endIso}T12:00:00.000Z`);
  while (cursor <= end) {
    days.push(isoDateUtc(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function weekdayCandidates(year, preferredIso) {
  const candidates = [preferredIso];
  const start = new Date(`${year}-06-01T12:00:00.000Z`);
  const end = new Date(`${year}-10-31T12:00:00.000Z`);
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const iso = isoDateUtc(cursor);
    const dow = cursor.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (!candidates.includes(iso)) candidates.push(iso);
  }
  return candidates;
}

async function submitSmokeHoliday(client, iso) {
  return rpc(client, "submit_staff_leave_request", {
    p_start_date: iso,
    p_end_date: iso,
    p_day_portion: "full",
    p_employee_note: "Smoke test request — safe to delete",
  });
}

async function findAndSubmitHoliday(client, year, preferredIso) {
  for (const iso of weekdayCandidates(year, preferredIso)) {
    const submit = await submitSmokeHoliday(client, iso);
    if (!submit.error && submit.data?.id) {
      return { iso, requestId: submit.data.id, submit };
    }
    if (!/overlap/i.test(submit.error?.message ?? "")) {
      return { iso, requestId: null, submit };
    }
  }
  throw new Error(`No free weekday for smoke leave submit in ${year}`);
}

async function main() {
  record(
    "Test Supabase project ref",
    ref === "axhkdwgmwhlbsstumndh",
    `got ${ref || "(unknown)"}`
  );

  const staffAId = await ensureStaffUser(STAFF_A);
  const staffBId = await ensureStaffUser(STAFF_B);

  const staffA = await signIn(STAFF_A.email, STAFF_A.password);
  const staffB = await signIn(STAFF_B.email, STAFF_B.password);

  const { data: adminListed } = await admin.auth.admin.listUsers({ perPage: 50 });
  const adminUser = adminListed?.users?.find((u) => u.email === "dan@candidcreative.uk");
  let adminSession = null;
  if (adminUser) {
    try {
      const link = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: adminUser.email,
      });
      const otpClient = createClient(url, anonKey, { auth: { persistSession: false } });
      if (link.data?.properties?.email_otp) {
        const { data: otpData, error: otpError } = await otpClient.auth.verifyOtp({
          type: "email",
          email: adminUser.email,
          token: link.data.properties.email_otp,
        });
        if (!otpError && otpData.session) {
          adminSession = {
            client: otpClient,
            session: otpData.session,
            userId: adminUser.id,
          };
        }
      }
    } catch {
      /* admin session optional */
    }
  }

  const balanceA = await rpc(staffA.client, "staff_leave_balance", {
    target_profile: staffA.userId,
    p_holiday_year: 2027,
  });
  record(
    "Staff can view own holiday balance (RPC)",
    !balanceA.error && Array.isArray(balanceA.data) && balanceA.data.length > 0,
    balanceA.error?.message
  );

  const balanceB = await rpc(staffB.client, "staff_leave_balance", {
    target_profile: staffB.userId,
    p_holiday_year: 2027,
  });
  const ent = balanceB.data?.[0]?.entitlement_days;
  record(
    "Full-time 2027 entitlement is 17 bookable days",
    !balanceB.error && Number(ent) === 17,
    `staff B entitlement_days=${ent} (staff A=${balanceA.data?.[0]?.entitlement_days} — reference only)`
  );

  const cross = await rpc(staffA.client, "staff_leave_balance", {
    target_profile: staffB.userId,
    p_holiday_year: 2027,
  });
  record(
    "Staff cannot access another employee balance (RPC)",
    /Forbidden|Unauthorized/i.test(cross.error?.message ?? ""),
    cross.error?.message ?? "unexpected success"
  );

  const apiBalance = await apiGet("/api/staff/leave/balance?year=2027", staffA.session.access_token);
  record(
    "Staff balance API accepts Bearer session",
    apiBalance.status === 200 && apiBalance.body?.balance?.entitlement_days != null,
    `HTTP ${apiBalance.status} ${apiBalance.body?.error ?? ""}`
  );

  const apiRequests = await apiGet("/api/staff/leave/requests?year=2027", staffA.session.access_token);
  record(
    "Staff requests API accepts Bearer session",
    apiRequests.status === 200 && Array.isArray(apiRequests.body?.requests),
    `HTTP ${apiRequests.status} ${apiRequests.body?.error ?? ""}`
  );

  const { iso: smokeIso, requestId, submit } = await findAndSubmitHoliday(
    staffB.client,
    2027,
    "2027-06-07"
  );
  record(
    "Staff can submit a holiday request",
    !submit.error && requestId,
    submit.error?.message
  );

  let declineRequestId = null;
  if (adminSession) {
    const declineSubmit = await rpc(staffB.client, "submit_staff_leave_request", {
      p_start_date: "2027-08-11",
      p_end_date: "2027-08-11",
      p_day_portion: "full",
      p_employee_note: "Smoke decline path",
    });
    declineRequestId = declineSubmit.data?.id;

    if (declineRequestId) {
      const declineApi = await apiPost(
        `/api/admin/leave/requests/${declineRequestId}/decide`,
        adminSession.session.access_token,
        { decision: "rejected", decisionNote: "Smoke decline" }
      );
      record(
        "Admin decline API accepts Bearer session",
        declineApi.status === 200 && declineApi.body?.request?.status === "rejected",
        `HTTP ${declineApi.status} ${declineApi.body?.error ?? ""}`
      );
    }
  } else {
    record("Admin decline API accepts Bearer session", false, "No admin session");
  }

  if (adminSession && requestId) {
    const decide = await rpc(adminSession.client, "decide_staff_leave_request", {
      p_request_id: requestId,
      p_decision: "approved",
      p_decision_note: "Smoke approve",
    });
    record(
      "Admin can approve a request",
      !decide.error && decide.data?.status === "approved",
      decide.error?.message
    );
  } else if (adminSession) {
    record("Admin can approve a request", false, submit.error?.message ?? "submit did not return id");
  } else if (requestId) {
    record("Admin can approve a request", false, "Could not obtain admin session");
  }

  let selfRequestId = null;
  if (adminSession) {
    const selfSubmit = await rpc(adminSession.client, "submit_staff_leave_request", {
      p_start_date: "2027-07-07",
      p_end_date: "2027-07-07",
      p_day_portion: "full",
    });
    selfRequestId = selfSubmit.data?.id;
    if (selfRequestId) {
      const selfDecide = await rpc(adminSession.client, "decide_staff_leave_request", {
        p_request_id: selfRequestId,
        p_decision: "approved",
      });
      record(
        "Staff/admin cannot approve own request",
        /cannot decide their own/i.test(selfDecide.error?.message ?? ""),
        selfDecide.error?.message ?? "unexpected approval"
      );
    }
  } else {
    record("Staff/admin cannot approve own request", false, "No admin session");
  }

  let sicknessId = null;
  if (adminSession) {
    const sick = await rpc(adminSession.client, "record_staff_absence_sickness", {
      p_profile_id: staffB.userId,
      p_start_date: "2027-03-02",
      p_end_date: "2027-03-02",
      p_day_portion: "full",
      p_reason: "Smoke test",
      p_note: "Visible note",
      p_private_note: "PRIVATE_SMOKE_NOTE",
    });
    sicknessId = sick.data?.id;
    record(
      "Management can record sickness",
      !sick.error && sicknessId,
      sick.error?.message
    );
  } else {
    record("Management can record sickness", false, "No admin session");
  }

  const ownList = await rpc(staffB.client, "list_staff_absence_sickness_own", {
    p_holiday_year: 2027,
  });
  const ownHasPrivate = (ownList.data ?? []).some((row) =>
    JSON.stringify(row).includes("PRIVATE_SMOKE_NOTE")
  );
  record(
    "Staff sickness list excludes private notes",
    !ownList.error && !ownHasPrivate,
    ownList.error?.message
  );

  const crossSick = await rpc(staffA.client, "list_staff_absence_sickness_own", {
    p_holiday_year: 2027,
  });
  const seesOtherSick = (crossSick.data ?? []).some((row) => row.profile_id === staffB.userId);
  record(
    "Staff cannot list another employee sickness rows",
    !seesOtherSick,
    seesOtherSick ? "saw other profile rows" : ""
  );

  if (adminSession) {
    const adminList = await rpc(adminSession.client, "list_staff_absence_sickness_admin", {
      p_profile_id: staffB.userId,
      p_holiday_year: 2027,
    });
    const adminSeesPrivate = (adminList.data ?? []).some(
      (row) => row.private_note === "PRIVATE_SMOKE_NOTE"
    );
    record(
      "Admin sickness history includes private notes",
      !adminList.error && adminSeesPrivate,
      adminList.error?.message
    );
  }

  const giftedRpc = await rpc(staffA.client, "staff_leave_balance", {
    target_profile: staffA.userId,
    p_holiday_year: 2027,
  });
  const balanceGift = giftedRpc.data?.[0];
  const reserved = Number(balanceGift?.reserved_pool_days ?? NaN);
  record(
    "Reserved pool is 11 days (8 bank holidays + 3 compulsory closures on working days)",
    !giftedRpc.error && reserved === 11,
    giftedRpc.error?.message ?? `reserved_pool_days=${balanceGift?.reserved_pool_days}`
  );
  const gross = Number(balanceGift?.gross_allowance_days ?? NaN);
  record(
    "2027 gross allowance remains 28 (gifted 31 Dec does not reduce gross or bookable pool)",
    gross === 28,
    `gross_allowance_days=${balanceGift?.gross_allowance_days}`
  );

  const { data: gmailConn, error: gmailErr } = await admin
    .from("gmail_connections")
    .select("status,last_error")
    .limit(1)
    .maybeSingle();
  record(
    "Gmail connection remains healthy",
    !gmailErr && gmailConn?.status === "connected",
    gmailErr?.message ?? `status=${gmailConn?.status} last_error=${gmailConn?.last_error ?? "null"}`
  );

  await cleanupRequest(admin, requestId);
  await cleanupRequest(admin, selfRequestId);
  await cleanupRequest(admin, declineRequestId);
  await cleanupSickness(admin, sicknessId);

  const failed = results.filter((r) => !r.pass);
  console.log("\n--- Summary ---");
  console.log(`Supabase: ${ref}`);
  console.log(`App: ${appBase}`);
  console.log(`Passed: ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
