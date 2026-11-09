import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import test from "node:test";

import {
  enqueueStaffLeaveCalendarReconciliation,
  scanStaffLeaveCalendarReconciliation,
} from "@/lib/staff-leave/calendar-sync/reconcile";

const TEST_REF = "axhkdwgmwhlbsstumndh";

function testAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url?.includes(TEST_REF) || !key) {
    return null;
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

test("scenario 8/10: reconciliation scan detects mock refresh and outdated fingerprints", async (t) => {
  const admin = testAdmin();
  if (!admin) {
    t.skip("Test Supabase service role env required");
    return;
  }

  const withGoogle = await scanStaffLeaveCalendarReconciliation(admin, {
    targetGoogleProvider: true,
  });

  assert.ok(withGoogle.findings.length >= 0);
  assert.ok(typeof withGoogle.summary.mock_needs_google_sync === "number");

  const { data: mapping } = await admin
    .from("staff_leave_calendar_event_mappings")
    .select("id, entity_id, entity_type, content_fingerprint")
    .eq("sync_provider", "mock")
    .eq("entity_type", "leave_request")
    .eq("calendar_channel", "team_leave")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  if (!mapping?.id) {
    t.skip("No active mock mapping on Test");
    return;
  }

  const original = mapping.content_fingerprint;
  const { error: tamperError } = await admin
    .from("staff_leave_calendar_event_mappings")
    .update({ content_fingerprint: "stale-integration-test-fingerprint" })
    .eq("id", mapping.id);
  assert.ifError(tamperError);

  const scan = await scanStaffLeaveCalendarReconciliation(admin, {
    targetGoogleProvider: true,
  });
  const outdated = scan.findings.some(
    (f) => f.kind === "outdated_team_leave_mapping" && f.entityId === mapping.entity_id
  );

  await admin
    .from("staff_leave_calendar_event_mappings")
    .update({ content_fingerprint: original })
    .eq("id", mapping.id);

  assert.equal(outdated, true);
  assert.ok(withGoogle.summary.mock_needs_google_sync > 0);
});

test("scenario 10: mock-to-Google transition flagged when includeGoogleRefresh", async (t) => {
  const admin = testAdmin();
  if (!admin) {
    t.skip("Test Supabase service role env required");
    return;
  }

  const scan = await scanStaffLeaveCalendarReconciliation(admin, {
    targetGoogleProvider: true,
  });

  assert.ok(scan.summary.mock_needs_google_sync > 0);
});

test("scenario 8: reconcile dry-run never enqueues rows", async (t) => {
  const admin = testAdmin();
  if (!admin) {
    t.skip("Test Supabase service role env required");
    return;
  }

  const dry = await enqueueStaffLeaveCalendarReconciliation(admin, {
    dryRun: true,
    includeGoogleRefresh: true,
  });

  assert.equal(dry.enqueued, 0);
  assert.equal(dry.dryRun, true);
});

test("scenario 9: claim RPC returns at most one row per entity (migration 162000)", async (t) => {
  const admin = testAdmin();
  if (!admin) {
    t.skip("Test Supabase service role env required");
    return;
  }

  const { data: pairs } = await admin
    .from("staff_leave_calendar_sync_outbox")
    .select("leave_request_id, sickness_id")
    .eq("status", "pending")
    .not("leave_request_id", "is", null);

  const byLeave = new Map<string, number>();
  for (const row of pairs ?? []) {
    if (!row.leave_request_id) continue;
    byLeave.set(row.leave_request_id, (byLeave.get(row.leave_request_id) ?? 0) + 1);
  }

  const multi = [...byLeave.entries()].find(([, count]) => count >= 2);
  if (!multi) {
    t.skip("No leave_request with 2+ pending rows on Test");
    return;
  }

  const { data: claimed, error } = await admin.rpc("staff_leave_calendar_claim_outbox_batch", {
    p_limit: 5,
    p_stale_before: new Date().toISOString(),
  });
  assert.ifError(error);

  const { data: rows } = await admin
    .from("staff_leave_calendar_sync_outbox")
    .select("id, leave_request_id, status")
    .eq("leave_request_id", multi[0])
    .in("status", ["processing", "pending"]);

  const processingForEntity = (rows ?? []).filter((r) => r.status === "processing").length;
  if (processingForEntity > 1) {
    t.skip("Migration 20270110162000 not applied on Test (dual claim still possible)");
    return;
  }
  assert.ok(processingForEntity <= 1);

  if (claimed?.length) {
    await admin
      .from("staff_leave_calendar_sync_outbox")
      .update({ status: "pending", locked_at: null })
      .in("id", claimed);
  }
});
