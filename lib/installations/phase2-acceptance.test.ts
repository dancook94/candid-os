import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../supabase/migrations/20270110168000_installation_phase2_acceptance.sql",
  import.meta.url
);

test("phase 2 adds classification without backfilling historical quotes", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /work_class IN \('print_supply', 'delivery', 'installation'\)/);
  assert.match(sql, /installation_auto_reconcile boolean NOT NULL DEFAULT false/);
  assert.doesNotMatch(sql, /\bUPDATE\s+public\.quote_items\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+public\.quote_versions\b/i);
  assert.doesNotMatch(sql, /LIKE '%installation%'/i);
  assert.doesNotMatch(sql, /component_type/);
});

test("only an included installation line qualifies", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const qualifier = sql.slice(
    sql.indexOf("installation_version_requires_project"),
    sql.indexOf("installation_reconcile_job_core")
  );

  assert.match(qualifier, /installation_quote_item_in_version\(qi\)/);
  assert.match(qualifier, /qi\.work_class = 'installation'/);
});

test("service-role entry checks acceptance and delegates to the shared writer", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const entry = sql.slice(sql.indexOf("installation_reconcile_accepted_job"));
  const core = sql.slice(
    sql.indexOf("installation_reconcile_job_core"),
    sql.indexOf("REVOKE ALL ON FUNCTION public.installation_reconcile_job_core")
  );

  assert.match(entry, /coalesce\(auth\.role\(\), v_role\) IS DISTINCT FROM 'service_role'/);
  assert.match(entry, /version_status IS DISTINCT FROM 'accepted'/);
  assert.match(entry, /installation_auto_reconcile/);
  assert.match(entry, /Not a phase 2 acceptance/);
  assert.match(entry, /installation_reconcile_job_core\(p_job_id, p_actor\)/);
  assert.doesNotMatch(entry, /INSERT INTO public\.installation_projects/);
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.installation_reconcile_accepted_job\(uuid, uuid\) TO service_role/
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.installation_reconcile_accepted_job\(uuid, uuid\) FROM PUBLIC, anon, authenticated/
  );
  assert.match(core, /IF v_project_id IS NULL/);
  assert.match(core, /IF v_visit_count = 0/);
  assert.doesNotMatch(core, /UPDATE public\.installation_visits/);
  assert.match(
    sql,
    /installation_assert_manager\(\)[\s\S]*installation_reconcile_job_core\(p_job_id, auth\.uid\(\)\)/
  );
});

test("customer and admin acceptance set the flag and retry stays on the job path", async () => {
  const status = await readFile(
    new URL("../../lib/quote-status-response.ts", import.meta.url),
    "utf8"
  );
  const jobs = await readFile(
    new URL("../../lib/jobs/create-from-quote.ts", import.meta.url),
    "utf8"
  );
  const customer = await readFile(
    new URL("../../lib/customer-quote-response.ts", import.meta.url),
    "utf8"
  );
  const admin = await readFile(
    new URL("../../lib/admin-quote-actions.ts", import.meta.url),
    "utf8"
  );
  const panel = await readFile(
    new URL("../../components/admin-quote-linked-job-panel.tsx", import.meta.url),
    "utf8"
  );

  assert.equal(status.match(/installation_auto_reconcile: true/g)?.length, 2);
  assert.equal(status.match(/await acceptanceClassificationError/g)?.length, 2);
  const reconcile = await readFile(new URL("./reconcile.ts", import.meta.url), "utf8");

  assert.match(customer, /reconcileJobForAcceptedQuote/);
  assert.match(admin, /ensureJobForAcceptedQuote/);
  assert.match(jobs, /reconcileAcceptedInstallation/);
  assert.match(reconcile, /installation_reconcile_status/);
  assert.match(reconcile, /HISTORICAL_RECONCILE_SKIP_REASON/);
  assert.match(panel, /Retry installation setup/);
  assert.match(panel, /\/ensure-job/);

  const checklist = await readFile(
    new URL("../../scripts/verify-installation-phase1-final.mjs", import.meta.url),
    "utf8"
  );
  assert.match(checklist, /Quote acceptance wired to Phase 2 installation reconcile/);
  assert.doesNotMatch(checklist, /Quote acceptance NOT wired/);
});

test("every quote line shows the three work classes before costing", async () => {
  const line = await readFile(
    new URL("../../components/quote-builder-line-item.tsx", import.meta.url),
    "utf8"
  );
  const form = await readFile(
    new URL("../../components/quote-builder-form.tsx", import.meta.url),
    "utf8"
  );
  const costing = await readFile(
    new URL("../../components/quote-line-costing-panel.tsx", import.meta.url),
    "utf8"
  );
  const controlAt = line.indexOf('role="radiogroup"');
  const gridAt = line.indexOf("lg:grid-cols-");

  assert.ok(controlAt > 0 && controlAt < gridAt);
  assert.match(line, /WORK_CLASS_LABELS\[workClass\]/);
  assert.match(line, /workClassOverridden: true/);
  assert.doesNotMatch(line, /<select/);
  assert.doesNotMatch(costing, /workClass/);
  assert.match(form, /work_class: item\.workClass/);
  assert.match(form, /work_class_overridden: item\.workClassOverridden/);
  assert.match(form, /item\.workClassOverridden\s*\?\s*\{\}/);
});
