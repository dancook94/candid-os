import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { quoteRequiresInstallation } from "@/lib/installations/classification";

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

test("quote acceptance calls the service-role reconcile entry and does not insert projects", async () => {
  const createFromQuote = await readFile(
    new URL("../../lib/jobs/create-from-quote.ts", import.meta.url),
    "utf8"
  );
  const reconcile = await readFile(
    new URL("./reconcile.ts", import.meta.url),
    "utf8"
  );

  assert.match(createFromQuote, /reconcileAcceptedInstallation/);
  assert.equal(createFromQuote.match(/attachInstallationWarning/g)?.length, 3);
  assert.doesNotMatch(createFromQuote, /from\("installation_projects"\)/);
  assert.match(reconcile, /installation_reconcile_accepted_job/);
  assert.doesNotMatch(reconcile, /from\("installation_projects"\)/);
  assert.doesNotMatch(reconcile, /from\("installation_visits"\)/);
});

test("a title containing installation does not by itself require a project", () => {
  assert.equal(
    quoteRequiresInstallation([
      {
        isOptional: false,
        isSelected: true,
        workClass: null,
      },
    ]),
    false
  );
});
