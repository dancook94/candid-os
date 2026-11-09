#!/usr/bin/env node
/**
 * Read-only probe: whether 153000-style functions exist on Candid OS Test.
 * Does not modify the database.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ref = url?.match(/https:\/\/([^.]+)\./)?.[1] ?? "";
if (ref !== "axhkdwgmwhlbsstumndh") {
  console.error(`Refuse: expected axhkdwgmwhlbsstumndh, got ${ref || "(unset)"}`);
  process.exit(2);
}

async function adminClient() {
  const adminSvc = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: users } = await adminSvc.auth.admin.listUsers({ perPage: 100 });
  const adminUser = users?.users?.find((u) => u.email === "dan@candidcreative.uk");
  if (!adminUser) throw new Error("Admin user not found");
  const link = await adminSvc.auth.admin.generateLink({ type: "magiclink", email: adminUser.email });
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  await client.auth.verifyOtp({
    type: "email",
    email: adminUser.email,
    token: link.data.properties.email_otp,
  });
  const { data: listed } = await adminSvc.auth.admin.listUsers({ perPage: 200 });
  const staff = listed?.users?.find((u) => u.email === "leave-smoke-staff-a@leave-smoke.test");
  return { client, staffId: staff?.id };
}

async function main() {
  const { client, staffId } = await adminClient();
  if (!staffId) throw new Error("Smoke staff A missing");

  const bal = await client.rpc("staff_leave_balance", {
    target_profile: staffId,
    p_holiday_year: 2027,
  });
  const bd = await client.rpc("staff_leave_entitlement_breakdown", {
    target_profile: staffId,
    p_holiday_year: 2027,
  });

  const row = Array.isArray(bd.data) ? bd.data[0] : bd.data;
  const reserved = Number(row?.reserved_pool_days ?? 0);
  const bank = Number(row?.bank_holidays_on_working_days ?? 0);
  const compulsory = Number(row?.compulsory_closures_on_working_days ?? 0);

  console.log("--- Read-only Test state ---");
  console.log(`staff_leave_balance: ${bal.error ? `ERROR ${bal.error.message}` : "OK"}`);
  if (bal.data?.[0]) {
    console.log(`  entitlement_days=${bal.data[0].entitlement_days} reserved_pool_days=${bal.data[0].reserved_pool_days}`);
  }
  console.log(`staff_leave_entitlement_breakdown: ${bd.error ? `ERROR ${bd.error.message}` : "OK"}`);
  if (row) {
    console.log(
      `  bookable=${row.bookable_entitlement_days} reserved=${reserved} bank=${bank} compulsory=${compulsory} gift=${row.paid_gift_closures_on_working_days}`
    );
    const closureAligned = Math.abs(reserved - (bank + compulsory)) <= 0.02 || reserved === 0;
    console.log(`  closure counts aligned with reserved: ${closureAligned ? "likely 153000 breakdown" : "likely pre-153000 breakdown"}`);
  }

  if (bal.error?.message?.includes("holiday_year") && bal.error?.message?.includes("ambiguous")) {
    console.log("\nVerdict: 153000 reserved_pool hotfix NOT applied (152000 ambiguity still present).");
  } else if (!bal.error && row && Math.abs(reserved - (bank + compulsory)) <= 0.02) {
    console.log("\nVerdict: 153000 appears applied (balance OK + closure alignment).");
  } else if (!bal.error) {
    console.log("\nVerdict: partial or alternate state — re-check after full 153000 apply.");
  } else {
    console.log("\nVerdict: inconclusive — inspect errors above.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
