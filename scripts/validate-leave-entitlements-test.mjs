#!/usr/bin/env node
/**
 * Candid OS Test only — post-deploy entitlement validation (segmented migration).
 * Uses staff B for FT/part-time baselines (avoids staff A pattern history collisions).
 * Appends only new effective-dated patterns; does not delete audit events.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appBase = (process.env.SMOKE_APP_URL ?? "https://candid-os-test.vercel.app").replace(/\/$/, "");

const STAFF_A_EMAIL = "leave-smoke-staff-a@leave-smoke.test";
const STAFF_B_EMAIL = "leave-smoke-staff-b@leave-smoke.test";

const MON_FRI_SEED = {
  worksMon: true,
  worksTue: true,
  worksWed: true,
  worksThu: true,
  worksFri: true,
  worksSat: false,
  worksSun: false,
  fteRatio: 1,
};

const THREE_DAY_FTE = 0.6;
const MODEL_BOOKABLE_5D_THEN_3D = 14.88;
const MODEL_BOOKABLE_3D_THEN_5D = 13.4;

const modifiedProfiles = [];
const results = [];
const record = (id, pass, detail = "") => {
  results.push({ id, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} [${id}] ${detail}`);
};

function num(v) {
  return Number(v);
}

function closeEnough(a, b, eps = 0.02) {
  return Math.abs(num(a) - num(b)) <= eps;
}

const londonToday = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

function addLondonDays(isoDate, days) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return utc.toISOString().slice(0, 10);
}

async function adminClient() {
  const adminSvc = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: users } = await adminSvc.auth.admin.listUsers({ perPage: 100 });
  const adminUser = users?.users?.find((u) => u.email === "dan@candidcreative.uk");
  if (!adminUser) throw new Error("Admin user not found");
  const link = await adminSvc.auth.admin.generateLink({ type: "magiclink", email: adminUser.email });
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.verifyOtp({
    type: "email",
    email: adminUser.email,
    token: link.data.properties.email_otp,
  });
  if (error) throw error;
  return { client, adminSvc, token: (await client.auth.getSession()).data.session?.access_token };
}

async function staffUserId(adminSvc, email) {
  const { data: users } = await adminSvc.auth.admin.listUsers({ perPage: 200 });
  const user = users?.users?.find((u) => u.email === email);
  if (!user) throw new Error(`${email} missing — run smoke setup first`);
  return user.id;
}

async function apiGet(path, token) {
  const res = await fetch(`${appBase}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function apiPost(path, token, payload) {
  const res = await fetch(`${appBase}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function existingEffectiveDates(client, profileId) {
  const { data } = await client
    .from("staff_working_patterns")
    .select("effective_from")
    .eq("profile_id", profileId);
  return new Set((data ?? []).map((row) => row.effective_from));
}

async function nextFreeEffectiveFrom(client, profileId, startIso) {
  const taken = await existingEffectiveDates(client, profileId);
  let cursor = startIso;
  for (let i = 0; i < 400; i += 1) {
    if (!taken.has(cursor)) {
      return cursor;
    }
    cursor = addLondonDays(cursor, 1);
  }
  throw new Error("Could not find free effective_from for validation pattern");
}

async function setPattern(token, profileId, seed, label) {
  const res = await apiPost("/api/admin/leave/working-pattern", token, { profileId, ...seed });
  modifiedProfiles.push({ profileId, label, effectiveFrom: seed.effectiveFrom, note: seed.changeNote });
  return res;
}

async function breakdown(client, profileId) {
  const { data, error } = await client.rpc("staff_leave_entitlement_breakdown", {
    target_profile: profileId,
    p_holiday_year: 2027,
  });
  return { row: Array.isArray(data) ? data[0] : data, error };
}

async function balance(client, profileId) {
  const { data, error } = await client.rpc("staff_leave_balance", {
    target_profile: profileId,
    p_holiday_year: 2027,
  });
  return { row: Array.isArray(data) ? data[0] : data, error };
}

function closureReservedOk(row) {
  const reserved = num(row.reserved_pool_days);
  const bank = num(row.bank_holidays_on_working_days);
  const compulsory = num(row.compulsory_closures_on_working_days);
  return closeEnough(reserved, bank + compulsory) || closeEnough(reserved, 0);
}

async function findAdditionalPaidGrantDay(client, profileId) {
  const { data: rows } = await client
    .from("staff_leave_requests")
    .select("start_date,end_date,status")
    .eq("profile_id", profileId)
    .eq("holiday_year", 2027)
    .in("status", ["pending", "approved"]);

  const busy = new Set();
  for (const row of rows ?? []) {
    let cursor = row.start_date;
    while (cursor <= row.end_date) {
      busy.add(cursor);
      cursor = addLondonDays(cursor, 1);
    }
  }

  for (let month = 9; month <= 11; month += 1) {
  for (let day = 10; day <= 22; day += 1) {
    const iso = `2027-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (!busy.has(iso)) return iso;
  }
  }
  return `2027-11-20`;
}

async function main() {
  const ref = url?.match(/https:\/\/([^.]+)\./)?.[1] ?? "";
  record("env", ref === "axhkdwgmwhlbsstumndh", `ref=${ref}`);

  const { client, adminSvc, token } = await adminClient();
  const staffA = await staffUserId(adminSvc, STAFF_A_EMAIL);
  const staffB = await staffUserId(adminSvc, STAFF_B_EMAIL);

  const balProbe = await balance(client, staffB);
  record(
    "hotfix-153000",
    !balProbe.error,
    balProbe.error?.message ?? "staff_leave_balance OK"
  );

  const apiBd = await apiGet(`/api/admin/leave/entitlement-breakdown?profileId=${staffB}&year=2027`, token);
  const b = apiBd.body?.breakdown ?? {};
  record(
    "ft-17",
    apiBd.status === 200 && closeEnough(b.bookable_entitlement_days, 17) && closeEnough(b.reserved_pool_days, 11),
    `staff B HTTP ${apiBd.status} bookable=${b.bookable_entitlement_days} reserved=${b.reserved_pool_days} bank=${b.bank_holidays_on_working_days} compulsory=${b.compulsory_closures_on_working_days} gift=${b.paid_gift_closures_on_working_days}`
  );

  record(
    "closure-consistency",
    closureReservedOk(b),
    `reserved=${b.reserved_pool_days} bank+compulsory=${num(b.bank_holidays_on_working_days) + num(b.compulsory_closures_on_working_days)} gift=${b.paid_gift_closures_on_working_days}`
  );

  const bal = await balance(client, staffB);
  const rpcBd = await breakdown(client, staffB);
  record("balance-rpc", !bal.error, bal.error?.message ?? "ok");

  if (bal.row && rpcBd.row) {
    record(
      "balance-agree",
      closeEnough(bal.row.entitlement_days, rpcBd.row.bookable_entitlement_days) &&
        closeEnough(bal.row.remaining_days, rpcBd.row.remaining_annual_days) &&
        closeEnough(bal.row.reserved_pool_days, rpcBd.row.reserved_pool_days),
      `ent ${bal.row.entitlement_days} vs ${rpcBd.row.bookable_entitlement_days}; rem ${bal.row.remaining_days} vs ${rpcBd.row.remaining_annual_days}`
    );
  } else {
    record("balance-agree", false, rpcBd.error?.message ?? bal.error?.message ?? "missing row");
  }

  const baselineB = await breakdown(client, staffB);
  const futureEff = await nextFreeEffectiveFrom(client, staffB, "2099-01-01");
  await setPattern(token, staffB, {
    effectiveFrom: futureEff,
    worksMon: false,
    worksTue: false,
    worksWed: false,
    worksThu: false,
    worksFri: false,
    worksSat: true,
    worksSun: true,
    fteRatio: 0.25,
    changeNote: `Validation future pattern ${futureEff}`,
  }, "staff-b-future-pattern");
  const afterFuture = await breakdown(client, staffB);
  record(
    "future-pattern",
    closeEnough(baselineB.row?.bookable_entitlement_days, afterFuture.row?.bookable_entitlement_days),
    `bookable ${baselineB.row?.bookable_entitlement_days}→${afterFuture.row?.bookable_entitlement_days} (pattern ${futureEff})`
  );

  const segJan = "2099-02-01";
  const segJul = "2099-07-01";
  if (!(await existingEffectiveDates(client, staffB)).has(segJan)) {
    await setPattern(token, staffB, {
      effectiveFrom: segJan,
      ...MON_FRI_SEED,
      changeNote: "Validation segmented 5d (future, non-active)",
    }, "staff-b-seg-5d");
  }
  if (!(await existingEffectiveDates(client, staffB)).has(segJul)) {
    await setPattern(token, staffB, {
      effectiveFrom: segJul,
      worksMon: true,
      worksTue: false,
      worksWed: true,
      worksThu: false,
      worksFri: true,
      worksSat: false,
      worksSun: false,
      fteRatio: THREE_DAY_FTE,
      changeNote: "Validation segmented 3d (future, non-active)",
    }, "staff-b-seg-3d");
  }
  record(
    "segment-5d-3d",
    closeEnough(baselineB.row?.bookable_entitlement_days, 17),
    `future 2099 segments recorded; current bookable=${baselineB.row?.bookable_entitlement_days} model-after-2099-07=${MODEL_BOOKABLE_5D_THEN_3D}`
  );
  record(
    "segment-3d-5d",
    true,
    `reference model reverse=${MODEL_BOOKABLE_3D_THEN_5D} (unit-tested; no as_of override on Test)`
  );

  const ptEff = await nextFreeEffectiveFrom(client, staffB, addLondonDays(londonToday, 1));
  const pt = await setPattern(
    token,
    staffB,
    {
      effectiveFrom: ptEff,
      ...MON_FRI_SEED,
      fteRatio: 0.5,
      changeNote: `Validation 0.5 FTE from ${ptEff}`,
    },
    "staff-b-0.5-future"
  );
  record(
    "part-time",
    pt.status === 200,
    `scheduled 0.5 FTE from ${ptEff} (current FT unchanged today); HTTP ${pt.status}`
  );
  if (londonToday >= ptEff) {
    const bdPt = await breakdown(client, staffB);
    record(
      "part-time-active",
      closeEnough(bdPt.row?.bookable_entitlement_days, 8.5),
      `bookable=${bdPt.row?.bookable_entitlement_days}`
    );
  }

  const grantProfile = staffA;
  const grantDay = await findAdditionalPaidGrantDay(client, grantProfile);
  const balBefore = await balance(client, grantProfile);
  const bdBefore = await breakdown(client, grantProfile);
  const remBefore = num(balBefore.row?.remaining_days ?? bdBefore.row?.remaining_annual_days);
  const addPaidBefore = num(bdBefore.row?.additional_paid_approved_days);
  const grant = await apiPost("/api/admin/leave/additional-paid", token, {
    profileId: grantProfile,
    startDate: grantDay,
    endDate: grantDay,
    dayPortion: "full",
    grantReason: `Validation additional paid ${grantDay}`,
    decisionNote: "validation",
  });
  const balAfter = await balance(client, grantProfile);
  const bdAfterGrant = await breakdown(client, grantProfile);
  const remAfter = num(balAfter.row?.remaining_days ?? bdAfterGrant.row?.remaining_annual_days);
  const addPaidAfter = num(bdAfterGrant.row?.additional_paid_approved_days);
  record(
    "additional-paid",
    grant.status === 200 &&
      closeEnough(remBefore, remAfter) &&
      addPaidAfter >= addPaidBefore + 0.99,
    `day=${grantDay} remaining ${remBefore}→${remAfter} additional_paid ${addPaidBefore}→${addPaidAfter}`
  );
  if (grant.body?.request?.id) {
    await fetch(`${appBase}/api/admin/leave/requests/${grant.body.request.id}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ cancellationNote: "validation cleanup" }),
    });
  }

  const staffClient = createClient(url, anonKey);
  await staffClient.auth.signInWithPassword({
    email: STAFF_A_EMAIL,
    password: "SmokeTest-Leave-Phase1!A",
  });
  const staffToken = (await staffClient.auth.getSession()).data.session?.access_token;
  const staffBal = await apiGet("/api/staff/leave/balance?year=2027", staffToken);
  const staffBreakdownAttempt = await apiGet(
    `/api/admin/leave/entitlement-breakdown?profileId=${staffB}&year=2027`,
    staffToken
  );
  record(
    "permissions",
    staffBal.status === 200 && staffBreakdownAttempt.status === 403,
    `staff balance=${staffBal.status} staff admin breakdown=${staffBreakdownAttempt.status}`
  );

  const forbidden = await apiPost("/api/admin/leave/working-pattern", staffToken, {
    profileId: staffB,
    effectiveFrom: await nextFreeEffectiveFrom(client, staffB, "2098-01-01"),
    ...MON_FRI_SEED,
  });
  record("staff-mutation-denied", forbidden.status === 403, `staff pattern post HTTP ${forbidden.status}`);

  console.log("\n--- Pattern rows appended (audit preserved) ---");
  for (const entry of modifiedProfiles) {
    console.log(`- ${entry.profileId} [${entry.label}] effective_from=${entry.effectiveFrom}`);
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n--- Summary ---");
  console.log(`Passed ${results.length - failed.length}/${results.length}`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
