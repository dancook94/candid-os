#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appBase = (process.env.SMOKE_APP_URL ?? "https://candid-os-test.vercel.app").replace(/\/$/, "");

const STAFF_B = {
  email: "leave-smoke-staff-b@leave-smoke.test",
  password: "SmokeTest-Leave-Phase1!B",
};

const results = [];
const record = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
};

async function apiGet(path, token) {
  const res = await fetch(`${appBase}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function apiPost(path, token, json) {
  const res = await fetch(`${appBase}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(json),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function weekdayCandidates(year, preferred) {
  const candidates = [preferred];
  const start = new Date(`${year}-06-01T12:00:00Z`);
  const end = new Date(`${year}-09-30T12:00:00Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    if (!candidates.includes(iso)) candidates.push(iso);
  }
  return candidates;
}

async function findOnBehalfBookableDay(staffClient, staffBId, adminToken, year, preferred) {
  for (const iso of weekdayCandidates(year, preferred)) {
    const { data, error } = await staffClient.rpc("preview_staff_leave_request_days", {
      target_profile: staffBId,
      p_start_date: iso,
      p_end_date: iso,
      p_day_portion: "full",
    });
    if (error || Number(data) <= 0) continue;

    const api = await apiGet(
      `/api/admin/leave/request-days?profileId=${staffBId}&startDate=${iso}&endDate=${iso}&dayPortion=full`,
      adminToken
    );
    if (api.status !== 200 || Math.abs(Number(api.body?.days) - Number(data)) > 0.001) {
      continue;
    }

    const probe = await apiPost("/api/admin/leave/requests", adminToken, {
      profileId: staffBId,
      startDate: iso,
      endDate: iso,
      dayPortion: "full",
      employeeNote: "Stage1 on-behalf verify",
    });
    if (probe.status === 200 && probe.body?.request?.id) {
      return { iso, days: Number(data), requestId: probe.body.request.id };
    }
    if (!/overlap/i.test(probe.body?.error ?? "")) continue;
  }
  throw new Error("no free on-behalf bookable day found");
}

async function adminSessionFromMagicLink(adminClient) {
  const { data: listed } = await adminClient.auth.admin.listUsers({ perPage: 50 });
  const adminUser = listed?.users?.find((u) => u.email === "dan@candidcreative.uk");
  if (!adminUser) return null;
  const link = await adminClient.auth.admin.generateLink({
    type: "magiclink",
    email: adminUser.email,
  });
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.verifyOtp({
    type: "email",
    email: adminUser.email,
    token: link.data?.properties?.email_otp,
  });
  if (error || !data.session) return null;
  return {
    client,
    session: data.session,
    userId: adminUser.id,
    email: adminUser.email,
    name: "dan@candidcreative.uk",
  };
}

async function main() {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const staffClient = createClient(url, anonKey, { auth: { persistSession: false } });
  await staffClient.auth.signInWithPassword(STAFF_B);
  const staffBId = (await staffClient.auth.getUser()).data.user?.id;

  const adminSess = await adminSessionFromMagicLink(admin);
  record("Admin session for Test", !!adminSess, adminSess ? adminSess.email : "no magiclink");

  const prevRpc = await staffClient.rpc("preview_staff_leave_request_days", {
    target_profile: staffBId,
    p_start_date: "2027-05-03",
    p_end_date: "2027-05-07",
    p_day_portion: "full",
  });
  record(
    "RPC preview_staff_leave_request_days (May bank holiday week)",
    !prevRpc.error && Number(prevRpc.data) === 4,
    prevRpc.error?.message ?? `days=${prevRpc.data} (expect 4 working days)`
  );

  const prevHalf = await staffClient.rpc("preview_staff_leave_request_days", {
    target_profile: staffBId,
    p_start_date: "2027-06-07",
    p_end_date: "2027-06-07",
    p_day_portion: "am",
  });
  record(
    "RPC preview half-day",
    !prevHalf.error && Number(prevHalf.data) === 0.5,
    prevHalf.error?.message ?? `days=${prevHalf.data}`
  );

  if (adminSess) {
    const booked = await findOnBehalfBookableDay(
      staffClient,
      staffBId,
      adminSess.session.access_token,
      2027,
      "2027-06-09"
    );
    const bookDay = booked.iso;
    const bookDays = booked.days;
    const onBehalfDay = booked.iso;
    const onBehalfId = booked.requestId;

    record(
      "API admin request-days preview",
      bookDays > 0,
      `${bookDay} → ${bookDays} day(s)`
    );

    const selfPreview = await apiGet(
      `/api/staff/leave/request-days?startDate=${bookDay}&endDate=${bookDay}&dayPortion=full`,
      adminSess.session.access_token
    );
    record(
      "API Book my holiday preview path",
      selfPreview.status === 200 && Number(selfPreview.body?.days) >= 0.5,
      `HTTP ${selfPreview.status} days=${selfPreview.body?.days}`
    );

    record(
      "Book leave for employee (pending)",
      !!onBehalfId,
      `request=${onBehalfId} date=${onBehalfDay}`
    );

    if (onBehalfId) {
      const { data: events, error: eventsError } = await adminSess.client
        .from("staff_leave_request_events")
        .select("payload, actor_profile_id")
        .eq("request_id", onBehalfId)
        .eq("event_type", "submitted");
      if (eventsError) {
        record("Audit events readable by admin", false, eventsError.message);
      }
      const ev = events?.[0];
      const payload = ev?.payload;
      record(
        "Audit submitted_on_behalf",
        payload?.submitted_on_behalf === true,
        JSON.stringify(payload ?? {})
      );
      record(
        "Submitted by manager (actor is admin)",
        ev?.actor_profile_id === adminSess.userId && ev?.actor_profile_id !== staffBId,
        `actor=${ev?.actor_profile_id}`
      );

      const selfDecide = await adminSess.client.rpc("decide_staff_leave_request", {
        p_request_id: onBehalfId,
        p_decision: "approved",
        p_decision_note: "should fail",
      });
      record(
        "Another manager can approve on-behalf request",
        !selfDecide.error && selfDecide.data?.status === "approved",
        selfDecide.error?.message ?? "approved OK"
      );

      const ownSubmit = await adminSess.client.rpc("submit_staff_leave_request", {
        p_start_date: onBehalfDay,
        p_end_date: onBehalfDay,
        p_day_portion: "full",
        p_employee_note: "admin own",
      });
      if (ownSubmit.data?.id && ownSubmit.data.profile_id === adminSess.userId) {
        const ownDecide = await adminSess.client.rpc("decide_staff_leave_request", {
          p_request_id: ownSubmit.data.id,
          p_decision: "approved",
        });
        record(
          "Self-approval protection (cannot approve own request)",
          /cannot decide their own/i.test(ownDecide.error?.message ?? ""),
          ownDecide.error?.message ?? "unexpected approval"
        );
        await adminSess.client.rpc("cancel_staff_leave_request", {
          p_request_id: ownSubmit.data.id,
          p_cancellation_note: "cleanup",
        });
      } else {
        record("Self-approval protection (cannot approve own request)", false, "could not create own request");
      }

      await adminSess.client.rpc("decide_staff_leave_request", {
        p_request_id: onBehalfId,
        p_decision: "rejected",
        p_decision_note: "Stage1 verify cleanup",
      });
    }

    const blockSelfOnBehalf = await apiPost(
      "/api/admin/leave/requests",
      adminSess.session.access_token,
      {
        profileId: adminSess.userId,
        startDate: "2027-10-13",
        endDate: "2027-10-13",
        dayPortion: "full",
      }
    );
    record(
      "API blocks on-behalf for self (Book my holiday)",
      blockSelfOnBehalf.status === 400,
      `HTTP ${blockSelfOnBehalf.status} ${blockSelfOnBehalf.body?.error ?? ""}`
    );
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n--- Summary ---\nPassed ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
