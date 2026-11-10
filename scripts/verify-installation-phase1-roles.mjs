/**
 * Installation Phase 1 — rollback-only role + reconcile verification (Test).
 * Uses Postgres session simulation (SET ROLE authenticated + request.jwt.claim.sub).
 * This is NOT equivalent to live Supabase JWT / PostgREST testing.
 *
 * Expected denials use SAVEPOINT so the outer transaction stays valid (no 25P02).
 *
 * DATABASE_URL='postgresql://postgres.<ref>:…' node scripts/verify-installation-phase1-roles.mjs
 */
import { fileURLToPath } from "node:url";
import {
  loadInstallationTestEnv,
  resolveInstallationDatabaseUrl,
  queryInstallationSelectGrantCount,
  queryInstallationRlsHelperGrantCount,
} from "./lib/installation-phase1-test-env.mjs";

const INSTALLATION_TABLES = 8;
const RLS_HELPERS = 3;

const root = fileURLToPath(new URL("..", import.meta.url));
loadInstallationTestEnv(root);

const url = resolveInstallationDatabaseUrl(root);

if (!url) {
  console.error("UNVERIFIED: DATABASE_URL for Test is required.");
  process.exit(2);
}

const pg = await import("pg");
const client = new pg.default.Client({ connectionString: url });
await client.connect();

/** @type {{ id: string, status: 'PASS'|'FAIL'|'UNVERIFIED'|'SKIP', detail?: string }[]} */
const results = [];

let savepointSeq = 0;

function record(id, status, detail) {
  results.push({ id, status, detail });
  console.log(status.padEnd(10), id, detail ?? "");
}

async function savepointName(label) {
  const safe = label.replace(/[^a-z0-9_]/gi, "_").slice(0, 48);
  savepointSeq += 1;
  return `sp_${savepointSeq}_${safe}`;
}

async function rollbackSavepoint(sp) {
  await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
  await client.query(`RELEASE SAVEPOINT ${sp}`);
}

async function profileForRole(role) {
  const { rows } = await client.query(
    `SELECT id FROM public.profiles
     WHERE account_status = 'approved' AND user_role = $1
     ORDER BY created_at NULLS LAST LIMIT 1`,
    [role]
  );
  return rows[0]?.id ?? null;
}

/** RESET ROLE after SET LOCAL ROLE authenticated; never throw 25P02 into denial tests. */
async function resetSessionRoleSafe() {
  try {
    await client.query("RESET ROLE");
  } catch (error) {
    if (error.code !== "25P02") throw error;
  }
}

/** Synthetic jwt subs when Test lacks accounts/customer profiles (not installation readers). */
/** Must be valid hex UUIDs (auth.uid() casts jwt sub to uuid). */
const SYNTHETIC_JWT = {
  accounts: "00000000-0000-4000-8000-00000000ac01",
  customer: "00000000-0000-4000-8000-0000000000c1",
};

async function withJwt(profileId, fn) {
  const claims = JSON.stringify({ sub: profileId, role: "authenticated" });
  await client.query(`SET LOCAL ROLE authenticated`);
  await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [profileId]);
  await client.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`);
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims]);
  try {
    return await fn();
  } finally {
    await resetSessionRoleSafe();
  }
}

/**
 * Run a test expected to succeed; errors roll back only the savepoint.
 */
async function runPassing(id, fn) {
  const sp = await savepointName(id);
  await client.query(`SAVEPOINT ${sp}`);
  try {
    const result = await fn();
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return result;
  } catch (error) {
    if (error.code === "25P02") {
      record(id, "FAIL", "transaction already aborted (savepoint not used upstream)");
      throw error;
    }
    try {
      await rollbackSavepoint(sp);
    } catch (rollbackErr) {
      record(id, "FAIL", `after error: ${rollbackErr.message}`);
      throw rollbackErr;
    }
    record(id, "FAIL", error.message);
    return null;
  }
}

/**
 * Run a test expected to raise (permission denied / business rule).
 */
async function expectDenial(id, fn) {
  const sp = await savepointName(id);
  await client.query(`SAVEPOINT ${sp}`);
  let denialError = null;
  try {
    await fn();
  } catch (error) {
    denialError = error;
  }

  try {
    await rollbackSavepoint(sp);
  } catch (rollbackErr) {
    record(id, "FAIL", `savepoint recovery: ${rollbackErr.message}`);
    return false;
  }

  if (!denialError) {
    record(id, "FAIL", "expected denial");
    return false;
  }
  if (denialError.code === "25P02") {
    record(id, "FAIL", "transaction aborted before savepoint rollback");
    return false;
  }
  record(id, "PASS", (denialError.message ?? "denied").slice(0, 160));
  return true;
}

const roles = {
  admin: await profileForRole("admin"),
  production: await profileForRole("production"),
  sales: await profileForRole("sales"),
  accounts: await profileForRole("accounts"),
  customer: await profileForRole("customer"),
};

for (const [role, id] of Object.entries(roles)) {
  if ((role === "accounts" || role === "customer") && !id) {
    record(
      `fixture.profile.${role}`,
      "SKIP",
      "no approved profile on Test; denial checks use synthetic jwt sub"
    );
  } else {
    record(
      `fixture.profile.${role}`,
      id ? "PASS" : "UNVERIFIED",
      id ? String(id) : "no approved profile on Test"
    );
  }
}

const selectGrantCount = await queryInstallationSelectGrantCount(client);
record(
  "schema.select_grants",
  selectGrantCount === INSTALLATION_TABLES ? "PASS" : "FAIL",
  `authenticated SELECT on ${selectGrantCount}/${INSTALLATION_TABLES} tables — apply 20270110166000_installation_phase1_table_select_grants.sql on Test if < ${INSTALLATION_TABLES}`
);

const rlsHelperGrantCount = await queryInstallationRlsHelperGrantCount(client);
record(
  "schema.rls_helper_grants",
  rlsHelperGrantCount === RLS_HELPERS ? "PASS" : "FAIL",
  `authenticated EXECUTE on reader/operator/manager helpers ${rlsHelperGrantCount}/${RLS_HELPERS} — apply 20270110167000_installation_phase1_rls_helper_grants.sql on Test if < ${RLS_HELPERS}`
);

await client.query("BEGIN");

let fixtureProjectId = null;
let fixtureVisitId = null;
let fixtureCompanyId = null;
const fixtureTag = `install-p1-verify-${Date.now()}`;

/**
 * Rollback-only accepted job + quote version with a qualifying installation line.
 * Uses existing company/contact; customer_visible false; unique job_reference.
 */
async function seedRollbackReconcileJob(companyId, contactId, adminProfileId) {
  const jobRef = `P1V-${fixtureTag.replace(/[^a-z0-9]/gi, "").slice(-20)}`;
  const projectName = `Rollback reconcile verify ${fixtureTag}`;
  return client.query(
    `
    WITH qn AS (SELECT public.allocate_next_quote_number() AS n),
    ins_quote AS (
      INSERT INTO public.quotes (
        quote_number, company_id, contact_id, project_name, status, current_version, created_by
      )
      SELECT n, $1::uuid, $2::uuid, $3, 'accepted', 1, $5::uuid FROM qn
      RETURNING id
    ),
    ins_ver AS (
      INSERT INTO public.quote_versions (
        quote_id, version_number, version_status, subtotal, vat_rate, vat_amount, total, accepted_at
      )
      SELECT id, 1, 'accepted', 0, 0, 0, 0, now() FROM ins_quote
      RETURNING id, quote_id
    ),
    ins_item AS (
      INSERT INTO public.quote_items (
        quote_version_id, sort_order, title, description, quantity, unit_price, line_total,
        is_optional, is_selected, work_class, work_class_overridden
      )
      SELECT id, 1, 'Site installation (rollback verify)', 'rollback-only fixture', 1, 0, 0, false, true, 'installation', true
      FROM ins_ver
      RETURNING quote_version_id
    ),
    ins_job AS (
      INSERT INTO public.jobs (
        company_id, quote_id, quote_version_id, job_reference, project_name, status,
        accepted_at, customer_visible, artwork_required
      )
      SELECT $1::uuid, v.quote_id, v.id, $4, $3, 'in_production', now(), false, false
      FROM ins_ver v
      RETURNING id
    )
    SELECT id FROM ins_job
    `,
    [companyId, contactId, projectName, jobRef, adminProfileId]
  );
}

async function resolveCompanyContactForReconcile() {
  if (fixtureCompanyId) {
    const contact = await client.query(
      `SELECT id FROM public.contacts
       WHERE company_id = $1 AND coalesce(is_active, true)
       ORDER BY created_at NULLS LAST LIMIT 1`,
      [fixtureCompanyId]
    );
    const contactId = contact.rows[0]?.id;
    return contactId ? { companyId: fixtureCompanyId, contactId } : null;
  }
  const { rows } = await client.query(`
    SELECT c.id AS company_id, ct.id AS contact_id
    FROM public.companies c
    JOIN public.contacts ct ON ct.company_id = c.id AND coalesce(ct.is_active, true)
    ORDER BY c.created_at NULLS LAST, ct.created_at NULLS LAST
    LIMIT 1
  `);
  if (!rows[0]?.company_id || !rows[0]?.contact_id) return null;
  return { companyId: rows[0].company_id, contactId: rows[0].contact_id };
}

try {
  const delivery = await runPassing("detection.delivery_only", () =>
    client.query(`
      SELECT public.installation_quote_line_qualifies('Delivery to site') AS d,
             public.installation_quote_line_qualifies('Site installation') AS i
    `)
  );
  if (delivery?.rows?.[0]) {
    const row = delivery.rows[0];
    record(
      "detection.delivery_only",
      row.d === false && row.i === true ? "PASS" : "FAIL",
      JSON.stringify(row)
    );
  }

  if (roles.admin) {
    const company = await client.query(
      `SELECT id FROM public.companies ORDER BY created_at LIMIT 1`
    );
    const companyId = company.rows[0]?.id;
    fixtureCompanyId = companyId ?? null;
    if (!companyId) {
      record("fixture.company", "UNVERIFIED", "no companies");
    } else {
      const created = await runPassing("admin.create_project", () =>
        withJwt(roles.admin, () =>
          client.query(
            `SELECT public.installation_project_create_manual($1::uuid, $2, $3, NULL::uuid) AS id`,
            [companyId, fixtureTag, "rollback-only fixture"]
          )
        )
      );
      fixtureProjectId = created?.rows?.[0]?.id ?? null;
      record(
        "admin.create_project",
        fixtureProjectId ? "PASS" : "FAIL",
        String(fixtureProjectId)
      );

      if (fixtureProjectId) {
        const visit = await runPassing("admin.create_visit", () =>
          withJwt(roles.admin, () =>
            client.query(
              `SELECT public.installation_visit_create_admin($1::uuid, $2, $3) AS id`,
              [fixtureProjectId, "Verify visit", "rollback"]
            )
          )
        );
        fixtureVisitId = visit?.rows?.[0]?.id ?? null;
        record("admin.create_visit", fixtureVisitId ? "PASS" : "FAIL", String(fixtureVisitId));
      }
    }
  }

  if (roles.production && fixtureVisitId) {
    const operated = await runPassing("production.operate_any_visit", () =>
      withJwt(roles.production, () =>
        client.query(
          `SELECT public.installation_visit_operational_progress($1::uuid, $2, NULL, NULL, $3, NULL)`,
          [fixtureVisitId, "on_site", "operational"]
        )
      )
    );
    if (operated && !results.some((r) => r.id === "production.operate_any_visit" && r.status === "FAIL")) {
      record("production.operate_any_visit", "PASS");
    }

    await expectDenial("production.cannot_schedule", () =>
      withJwt(roles.production, () =>
        client.query(
          `SELECT public.installation_visit_admin_schedule($1::uuid, 'scheduled', now(), now() + interval '2 hour')`,
          [fixtureVisitId]
        )
      )
    );

    await expectDenial("production.cannot_reopen", () =>
      withJwt(roles.production, () =>
        client.query(
          `SELECT public.installation_visit_manager_reopen($1::uuid, $2, 'scheduled')`,
          [fixtureVisitId, "should fail"]
        )
      )
    );
  }

  if (roles.sales && fixtureProjectId && fixtureVisitId) {
    const read = await runPassing("sales.read_project", () =>
      withJwt(roles.sales, () =>
        client.query(
          `SELECT count(*)::int AS n FROM public.installation_projects WHERE id = $1`,
          [fixtureProjectId]
        )
      )
    );
    if (read?.rows?.[0]) {
      record(
        "sales.read_project",
        read.rows[0].n === 1 ? "PASS" : "FAIL",
        read.rows[0].n === 1 ? "reader saw fixture project" : `saw ${read.rows[0].n} (check auth.uid + 166000 SELECT grants)`
      );
    } else if (!results.some((r) => r.id === "sales.read_project")) {
      record("sales.read_project", "FAIL", "query failed — see schema.select_grants");
    }

    await expectDenial("sales.cannot_operate", () =>
      withJwt(roles.sales, () =>
        client.query(
          `SELECT public.installation_visit_operational_progress($1::uuid, 'on_site')`,
          [fixtureVisitId]
        )
      )
    );
  }

  {
    const accountsSub = roles.accounts ?? SYNTHETIC_JWT.accounts;
    const read = await runPassing("accounts.denied_read", () =>
      withJwt(accountsSub, () =>
        client.query(`SELECT count(*)::int AS n FROM public.installation_projects`)
      )
    );
    if (read?.rows?.[0]) {
      record(
        "accounts.denied_read",
        read.rows[0].n === 0 ? "PASS" : "FAIL",
        read.rows[0].n === 0
          ? "RLS hid rows (non-reader)"
          : `saw ${read.rows[0].n} rows — policy bug${roles.accounts ? "" : " (synthetic jwt)"}`
      );
    } else if (!results.some((r) => r.id === "accounts.denied_read")) {
      record(
        "accounts.denied_read",
        "FAIL",
        "42501 without SELECT grant is not the phase-1 contract — apply 166000 then expect n=0 via RLS"
      );
    }
  }

  {
    const customerSub = roles.customer ?? SYNTHETIC_JWT.customer;
    const read = await runPassing("customer.denied_read", () =>
      withJwt(customerSub, () =>
        client.query(`SELECT count(*)::int AS n FROM public.installation_projects`)
      )
    );
    if (read?.rows?.[0]) {
      record(
        "customer.denied_read",
        read.rows[0].n === 0 ? "PASS" : "FAIL",
        read.rows[0].n === 0
          ? "RLS hid rows (non-reader)"
          : `saw ${read.rows[0].n} rows — policy bug${roles.customer ? "" : " (synthetic jwt)"}`
      );
    } else if (!results.some((r) => r.id === "customer.denied_read")) {
      record(
        "customer.denied_read",
        "FAIL",
        "42501 without SELECT grant is not the phase-1 contract — apply 166000 then expect n=0 via RLS"
      );
    }
  }

  if (roles.admin && fixtureVisitId) {
    const completed = await runPassing("admin.complete_visit", () =>
      withJwt(roles.admin, () =>
        client.query(
          `SELECT public.installation_visit_operational_progress($1::uuid, 'completed', NULL, NULL, NULL, 'done')`,
          [fixtureVisitId]
        )
      )
    );
    if (
      completed &&
      !results.some((r) => r.id === "admin.complete_visit" && r.status === "FAIL")
    ) {
      record("admin.complete_visit", "PASS");
    }

    if (roles.production) {
      await expectDenial("production.blocked_on_completed", () =>
        withJwt(roles.production, () =>
          client.query(
            `SELECT public.installation_visit_operational_progress($1::uuid, 'on_site')`,
            [fixtureVisitId]
          )
        )
      );
    }

    const reopenRpc = await runPassing("admin.reopen_rpc", () =>
      withJwt(roles.admin, () =>
        client.query(
          `SELECT public.installation_visit_manager_reopen($1::uuid, $2, 'scheduled')`,
          [fixtureVisitId, "Customer callback required"]
        )
      )
    );
    if (reopenRpc && !results.some((r) => r.id === "admin.reopen_rpc" && r.status === "FAIL")) {
      record("admin.reopen_rpc", "PASS", "manager reopen RPC");
    }
    const events = await client.query(
      `SELECT count(*)::int AS n FROM public.installation_visit_events
       WHERE installation_visit_id = $1 AND event_type = 'visit_reopened'`,
      [fixtureVisitId]
    );
    record(
      "admin.reopen_with_audit",
      (events.rows[0]?.n ?? 0) >= 1 ? "PASS" : "FAIL",
      `visit_reopened events=${events.rows[0]?.n ?? 0} (catalog read as session owner — not RLS)`
    );

    if (roles.production) {
      await runPassing("production.sign_off_capture", () =>
        withJwt(roles.production, () =>
          client.query(
            `SELECT public.installation_sign_off_capture($1::uuid, 'Test Customer', NULL, NULL)`,
            [fixtureVisitId]
          )
        )
      );

      const signOff = await client.query(
        `SELECT id FROM public.installation_sign_offs WHERE installation_visit_id = $1 LIMIT 1`,
        [fixtureVisitId]
      );
      const signOffId = signOff.rows[0]?.id;
      if (signOffId) {
        await expectDenial("production.cannot_mutate_signoff", () =>
          withJwt(roles.production, () =>
            client.query(
              `UPDATE public.installation_sign_offs SET notes = 'tamper' WHERE id = $1`,
              [signOffId]
            )
          )
        );
      } else {
        record("production.cannot_mutate_signoff", "UNVERIFIED", "no sign-off row");
      }
    }
  }

  if (roles.admin) {
    let jobId = null;
    const jobRows = await client.query(`
      SELECT j.id AS job_id
      FROM public.jobs j
      WHERE j.quote_version_id IS NOT NULL
        AND public.installation_version_requires_project(j.quote_version_id)
        AND NOT EXISTS (
          SELECT 1 FROM public.installation_projects ip WHERE ip.job_id = j.id
        )
      ORDER BY j.created_at DESC NULLS LAST
      LIMIT 1
    `);
    jobId = jobRows.rows[0]?.job_id ?? null;

    if (!jobId) {
      const pair = await resolveCompanyContactForReconcile();
      if (!pair) {
        record("reconcile.fixture", "UNVERIFIED", "no company/contact for rollback seed");
      } else {
        const seeded = await runPassing("reconcile.seed_fixture_job", () =>
          seedRollbackReconcileJob(pair.companyId, pair.contactId, roles.admin)
        );
        jobId = seeded?.rows?.[0]?.id ?? null;
        if (jobId) {
          const qualifies = await client.query(
            `SELECT public.installation_version_requires_project(j.quote_version_id) AS ok
             FROM public.jobs j WHERE j.id = $1`,
            [jobId]
          );
          const ok = qualifies.rows[0]?.ok === true;
          record(
            "reconcile.fixture",
            ok ? "PASS" : "FAIL",
            ok
              ? "rollback-only job + installation line qualifies"
              : "seeded job failed installation_version_requires_project"
          );
          if (!ok) jobId = null;
        } else if (!results.some((r) => r.id === "reconcile.seed_fixture_job" && r.status === "FAIL")) {
          record("reconcile.fixture", "FAIL", "seed returned no job id");
        }
      }
    }

    if (!jobId) {
      record("reconcile.qualifying_job", "UNVERIFIED", "no eligible job without project");
    } else {
      record("reconcile.qualifying_job", "PASS", String(jobId));

      const first = await runPassing("reconcile.first_call", () =>
        withJwt(roles.admin, () =>
          client.query(`SELECT public.installation_reconcile_for_job($1::uuid) AS result`, [
            jobId,
          ])
        )
      );
      const r1 = first?.rows?.[0]?.result;
      const projectId = r1?.project_id;
      record(
        "reconcile.creates_project",
        r1?.created_project === true && projectId ? "PASS" : "FAIL",
        JSON.stringify(r1)
      );

      const visitsAfterFirst = await client.query(
        `SELECT count(*)::int AS n, min(status) AS min_status FROM public.installation_visits WHERE installation_project_id = $1`,
        [projectId]
      );
      record(
        "reconcile.initial_unscheduled_visit",
        visitsAfterFirst.rows[0]?.n === 1 &&
          visitsAfterFirst.rows[0]?.min_status === "unscheduled"
          ? "PASS"
          : "FAIL",
        JSON.stringify(visitsAfterFirst.rows[0])
      );

      const manualTitle = "Manual title preserved";
      await client.query(
        `UPDATE public.installation_visits SET title = $2 WHERE installation_project_id = $1`,
        [projectId, manualTitle]
      );

      const second = await runPassing("reconcile.second_call", () =>
        withJwt(roles.admin, () =>
          client.query(`SELECT public.installation_reconcile_for_job($1::uuid) AS result`, [
            jobId,
          ])
        )
      );
      const r2 = second?.rows?.[0]?.result;
      record(
        "reconcile.idempotent_second_call",
        r2?.created_project === false && r2?.created_initial_visit === false ? "PASS" : "FAIL",
        JSON.stringify(r2)
      );

      const visitsAfterSecond = await client.query(
        `SELECT count(*)::int AS n, max(title) AS title FROM public.installation_visits WHERE installation_project_id = $1`,
        [projectId]
      );
      record(
        "reconcile.preserves_manual_visit",
        visitsAfterSecond.rows[0]?.n === 1 &&
          visitsAfterSecond.rows[0]?.title === manualTitle
          ? "PASS"
          : "FAIL",
        JSON.stringify(visitsAfterSecond.rows[0])
      );
    }
  }
} catch (error) {
  record("session.fatal", "FAIL", error.message);
} finally {
  await client.query("ROLLBACK");
  record("session.rollback", "PASS", "no durable writes from this script");
}

await client.end();

const failed = results.filter((r) => r.status === "FAIL");
const unverified = results.filter((r) => r.status === "UNVERIFIED");
const passed = results.filter((r) => r.status === "PASS");

console.log("\n--- SUMMARY ---");
console.log(
  JSON.stringify(
    { pass: passed.length, fail: failed.length, unverified: unverified.length, total: results.length },
    null,
    2
  )
);

if (failed.length) {
  console.error("\nFAIL:", failed.map((r) => r.id).join(", "));
  process.exit(1);
}

if (unverified.length) {
  console.error("\nUNVERIFIED:", unverified.map((r) => r.id).join(", "));
  process.exit(3);
}

process.exit(0);
