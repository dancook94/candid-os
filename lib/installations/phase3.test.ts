import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { conflictSummary } from "@/lib/installations/conflicts";

const MIGRATION = new URL(
  "../../supabase/migrations/20270110169000_installation_phase3_schedule.sql",
  import.meta.url
);

test("classification migrates a single class and leaves historical lines alone", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /requires_print_supply boolean NOT NULL DEFAULT false/);
  assert.match(sql, /requires_delivery boolean NOT NULL DEFAULT false/);
  assert.match(sql, /requires_installation boolean NOT NULL DEFAULT false/);
  assert.match(sql, /WHERE work_class IS NOT NULL/);
  assert.doesNotMatch(sql, /LIKE '%installation%'/i);
  assert.doesNotMatch(sql, /INSERT INTO public\.installation_projects/);
  assert.match(sql, /qi\.requires_installation\s+OR\s+qi\.work_class = 'installation'/);
});

test("scheduling locks installers and records an acknowledgement", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const commit = sql.slice(
    sql.indexOf("installation_visit_commit_schedule"),
    sql.indexOf("installation_visit_assign_confirmed")
  );
  const assign = sql.slice(
    sql.indexOf("installation_visit_assign_confirmed"),
    sql.indexOf("installation_project_update_details")
  );

  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /ORDER BY key/);
  assert.match(sql, /a\.profile_id = ANY\(p_profile_ids\)/);
  assert.match(commit, /FOR UPDATE/);
  assert.ok(commit.indexOf("p_acknowledge IS NOT TRUE") < commit.indexOf("UPDATE public.installation_visits"));
  assert.match(commit, /conflicts_acknowledged/);
  assert.match(assign, /installation_collect_conflicts/);
  assert.match(assign, /p_acknowledge IS NOT TRUE/);
  assert.match(sql, /installation_assert_manager\(\)/);
  assert.doesNotMatch(sql, /installation_visit_operational_progress/);
});

test("project completion is separate from visit completion", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const project = sql.slice(sql.indexOf("installation_project_update_details"));

  assert.match(project, /status NOT IN \('completed', 'cancelled'\)/);
  assert.match(project, /s\.status = 'open'/);
  assert.match(project, /p_acknowledge_completion IS NOT TRUE/);
  assert.doesNotMatch(project, /UPDATE public\.installation_visits/);
});

test("holiday integration is read-only and hides private absence detail", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const reader = sql.slice(
    sql.indexOf("installation_team_unavailability"),
    sql.indexOf("installation_preview_schedule_conflicts")
  );

  assert.match(reader, /installation_assert_reader\(\)/);
  assert.match(reader, /r\.status = 'approved'/);
  assert.doesNotMatch(reader, /private_note/);
  assert.doesNotMatch(reader, /employee_note/);
  assert.doesNotMatch(reader, /\.reason/);
  assert.doesNotMatch(sql, /UPDATE public\.staff_leave_requests/);
  assert.doesNotMatch(sql, /UPDATE public\.staff_absence_sickness/);
  assert.doesNotMatch(sql, /staff_leave_calendar_sync_outbox/);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.installation_collect_conflicts\(uuid, uuid\[\], timestamptz, timestamptz\) FROM PUBLIC, anon, authenticated/
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.installation_team_unavailability\(date, date\) TO authenticated/
  );
});

test("conflict text names the person and the other booking", () => {
  assert.match(
    conflictSummary({
      kind: "installation",
      profile_name: "Alex",
      project_title: "Shop front",
      scheduled_start_at: "2026-11-12T09:00:00.000Z",
    }),
    /Alex/
  );
  assert.match(
    conflictSummary({
      kind: "absence",
      profile_name: "Sam",
      start_date: "2026-11-12",
      end_date: "2026-11-12",
      day_portion: "am",
    }),
    /Sam has recorded absence/
  );
  assert.doesNotMatch(
    conflictSummary({
      kind: "absence",
      profile_name: "Sam",
      start_date: "2026-11-12",
      end_date: "2026-11-12",
      day_portion: "full",
    }),
    /reason|private/i
  );
});

const SERVICE_ROLE_SELECT = new URL(
  "../../supabase/migrations/20270110170000_installation_service_role_select.sql",
  import.meta.url
);

const INSTALLATION_TABLES = [
  "installation_projects",
  "installation_visits",
  "installation_visit_assignments",
  "installation_visit_documents",
  "installation_visit_photos",
  "installation_snag_items",
  "installation_sign_offs",
  "installation_visit_events",
] as const;

test("service role can read installation tables and cannot write them", async () => {
  const sql = await readFile(SERVICE_ROLE_SELECT, "utf8");
  const grants = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  for (const table of INSTALLATION_TABLES) {
    assert.match(grants, new RegExp(`GRANT SELECT ON TABLE public\\.${table} TO service_role;`));
  }

  assert.doesNotMatch(grants, /TO anon/i);
  assert.doesNotMatch(grants, /GRANT INSERT/i);
  assert.doesNotMatch(grants, /GRANT UPDATE/i);
  assert.doesNotMatch(grants, /GRANT DELETE/i);
  assert.doesNotMatch(grants, /TO authenticated/i);
});
