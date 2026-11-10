import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  detectInstallationSignals,
  jobRequiresInstallationProject,
} from "@/lib/installations/detection";

const MIGRATION = new URL(
  "../../supabase/migrations/20270110163000_installation_management_phase1.sql",
  import.meta.url
);

test("reconciliation design creates one project per job with initial unscheduled visit", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(sql, /installation_reconcile_for_job/);
  assert.match(sql, /'unscheduled'/);
  assert.doesNotMatch(sql, /required_date/);
});

test("quote acceptance is not wired in phase 1 lib", async () => {
  const createFromQuote = await readFile(
    new URL("../../lib/jobs/create-from-quote.ts", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(createFromQuote, /reconcileInstallationProjectForJob/);
  assert.doesNotMatch(createFromQuote, /installation_reconcile/);
});

test("idempotent reconcile logic only adds visit when project has zero visits", () => {
  const signals = detectInstallationSignals(
  [
      { id: "1", title: "Site installation", is_optional: false },
    ],
    []
  );

  assert.equal(jobRequiresInstallationProject(signals), true);
});
