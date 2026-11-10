/**
 * Phase 1 final verification (Test only: axhkdwgmwhlbsstumndh).
 *
 * Table existence: PostgREST .select('id').limit(1) — NOT HEAD/count (204 false positives).
 *   PGRST205 => missing; 42501 => table exists (direct service_role SELECT not granted).
 *
 * Deep checks (constraints, RLS policies, role matrix, reconcile idempotency):
 *   require DATABASE_URL containing the Test ref — otherwise UNVERIFIED.
 *
 * Usage:
 *   node scripts/verify-installation-phase1-final.mjs
 *   DATABASE_URL='postgresql://postgres.<ref>:…' node scripts/verify-installation-phase1-final.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  INSTALLATION_TEST_REF,
  loadInstallationTestEnv,
  resolveInstallationDatabaseUrl,
  installationTestSupabaseReady,
  missingInstallationTestSupabaseHints,
} from "./lib/installation-phase1-test-env.mjs";

const TEST_REF = INSTALLATION_TEST_REF;
const root = fileURLToPath(new URL("..", import.meta.url));

const envMeta = loadInstallationTestEnv(root);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

if (!installationTestSupabaseReady()) {
  const hints = missingInstallationTestSupabaseHints(root);
  console.error(`Refusing: need Test Supabase configuration:\n  - ${hints.join("\n  - ")}`);
  process.exit(2);
}
if (envMeta.supabaseUrlSource && installationTestSupabaseReady()) {
  console.log(
    `Using Test Supabase URL from ${envMeta.supabaseUrlSource}; shell Live exports are ignored.`
  );
}

function databaseUrl() {
  return resolveInstallationDatabaseUrl(root);
}

const TABLES = [
  "installation_projects",
  "installation_visits",
  "installation_visit_assignments",
  "installation_visit_documents",
  "installation_visit_photos",
  "installation_snag_items",
  "installation_sign_offs",
  "installation_visit_events",
];

const REQUIRED_INDEXES = [
  "installation_projects_job_id_unique_idx",
  "installation_visits_unique_number",
];

const OPERATIONAL_RPCS = [
  {
    name: "installation_reconcile_for_job",
    args: { p_job_id: "00000000-0000-4000-8000-000000000099" },
    exposed: (error) =>
      error && error.code !== "PGRST202" && /Forbidden|Job not found|permission/i.test(error.message),
  },
  {
    name: "installation_project_create_manual",
    args: {
      p_company_id: "00000000-0000-4000-8000-000000000001",
      p_title: "probe",
      p_description: null,
      p_job_id: null,
    },
    exposed: (error) => error && error.code !== "PGRST202",
  },
  {
    name: "installation_visit_create_admin",
    args: {
      p_project_id: "00000000-0000-4000-8000-000000000001",
      p_title: "probe",
      p_purpose: null,
    },
    exposed: (error) => error && error.code !== "PGRST202",
  },
  {
    name: "installation_visit_admin_schedule",
    args: {
      p_visit_id: "00000000-0000-4000-8000-000000000001",
      p_status: "scheduled",
      p_scheduled_start_at: new Date().toISOString(),
      p_scheduled_end_at: new Date(Date.now() + 3600000).toISOString(),
    },
    exposed: (error) => error && error.code !== "PGRST202",
  },
  {
    name: "installation_visit_assign_profile",
    args: {
      p_visit_id: "00000000-0000-4000-8000-000000000001",
      p_profile_id: "00000000-0000-4000-8000-000000000002",
      p_remove: false,
    },
    exposed: (error) => error && error.code !== "PGRST202",
  },
  {
    name: "installation_visit_operational_progress",
    args: {
      p_visit_id: "00000000-0000-4000-8000-000000000001",
      p_status: "on_site",
    },
    exposed: (error) => error && error.code !== "PGRST202",
  },
  {
    name: "installation_snag_upsert",
    args: {
      p_visit_id: "00000000-0000-4000-8000-000000000001",
      p_snag_id: null,
      p_description: "probe snag",
      p_status: null,
      p_resolution_notes: null,
    },
    exposed: (error) => error && error.code !== "PGRST202",
  },
  {
    name: "installation_sign_off_capture",
    args: {
      p_visit_id: "00000000-0000-4000-8000-000000000001",
      p_customer_name: "probe",
      p_notes: null,
      p_signature_storage_path: null,
    },
    exposed: (error) => error && error.code !== "PGRST202",
  },
  {
    name: "installation_register_visit_document",
    args: {
      p_visit_id: "00000000-0000-4000-8000-000000000001",
      p_document_kind: "other",
      p_storage_path: "00000000-0000-4000-8000-000000000001/documents/other/probe.pdf",
      p_file_name: "probe.pdf",
      p_mime_type: "application/pdf",
      p_byte_size: 1,
      p_linked_job_file_id: null,
    },
    exposed: (error) => error && error.code !== "PGRST202",
  },
  {
    name: "installation_register_visit_photo",
    args: {
      p_visit_id: "00000000-0000-4000-8000-000000000001",
      p_phase: "before",
      p_storage_path: "00000000-0000-4000-8000-000000000001/photos/before/probe.jpg",
      p_file_name: "probe.jpg",
      p_mime_type: "image/jpeg",
      p_byte_size: 1,
      p_captured_at: null,
    },
    exposed: (error) => error && error.code !== "PGRST202",
  },
  {
    name: "installation_visit_manager_reopen",
    args: {
      p_visit_id: "00000000-0000-4000-8000-000000000001",
      p_reason: "schema probe",
      p_target_status: "scheduled",
    },
    exposed: (error) => error && error.code !== "PGRST202",
  },
];

const checklist = [];

function record(id, title, status, detail) {
  checklist.push({ id, title, status, detail });
  const label = status === "PASS" ? "PASS" : status === "FAIL" ? "FAIL" : "UNVERIFIED";
  console.log(`${label} [${id}] ${title}${detail ? ` — ${detail}` : ""}`);
}

const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

/** @type {Record<string, string>} */
const tableProbe = {};

for (const table of TABLES) {
  const { error } = await admin.from(table).select("id").limit(1);
  if (!error) {
    tableProbe[table] = "OK";
    continue;
  }
  if (error.code === "PGRST205") {
    tableProbe[table] = "MISSING";
    continue;
  }
  if (error.code === "42501") {
    tableProbe[table] = "EXISTS_DENIED_SERVICE_ROLE";
    continue;
  }
  tableProbe[table] = `ERR:${error.code}`;
}

const tablesExist =
  TABLES.every(
    (t) =>
      tableProbe[t] === "OK" || tableProbe[t] === "EXISTS_DENIED_SERVICE_ROLE"
  ) && !TABLES.some((t) => tableProbe[t] === "MISSING");

record(
  "1a",
  "Eight installation tables visible to API or denied (exists)",
  tablesExist ? "PASS" : "FAIL",
  tablesExist
    ? "42501 on service_role SELECT is expected; use pg_catalog for grants."
    : JSON.stringify(tableProbe)
);

const rpcProbe = {};
for (const rpc of OPERATIONAL_RPCS) {
  const { error } = await admin.rpc(rpc.name, rpc.args);
  rpcProbe[rpc.name] = error
    ? { code: error.code, exposed: rpc.exposed(error), message: error.message }
    : { code: null, exposed: true };
}

const rpcsExposed = OPERATIONAL_RPCS.every((r) => rpcProbe[r.name]?.exposed);

record(
  "1b",
  "Installation RPCs exposed in PostgREST schema cache",
  rpcsExposed ? "PASS" : "FAIL",
  rpcsExposed
    ? `${OPERATIONAL_RPCS.length} RPCs probed`
    : Object.entries(rpcProbe)
        .filter(([, v]) => !v.exposed)
        .map(([k, v]) => `${k}:${v.code}`)
        .join(", ") +
        (Object.values(rpcProbe).some((v) => v.code === "PGRST202")
          ? " — run NOTIFY pgrst, 'reload schema'; in SQL Editor if migrations just applied."
          : "")
);

const { data: buckets, error: bucketErr } = await admin.storage.listBuckets();
const installBucket = buckets?.find((b) => b.id === "installation-files");

record(
  "7a",
  "installation-files storage bucket",
  !bucketErr && installBucket ? "PASS" : "FAIL",
  bucketErr?.message ?? (installBucket ? `public=${installBucket.public}` : "missing")
);

const dbUrl = databaseUrl();
if (!dbUrl) {
  for (const item of [
    ["1c", "Constraints, indexes, RLS policies (pg_catalog)", "Paste scripts/diagnose-installation-phase1-test.sql"],
    ["2", "Hardening functions in Postgres (installation_visit_exists, path validation)", "DATABASE_URL required"],
    ["3", "Role matrix (admin / production / sales / accounts / customer)", "node scripts/verify-installation-phase1-roles.mjs"],
    ["4", "Installers cannot schedule / assign / reopen", "roles script"],
    ["5", "Manager reopen with reason + audit event", "roles script"],
    ["6", "Sign-off immutability for installers", "roles script + triggers in SQL diagnostic"],
    ["7b", "Storage RLS policies (private bucket)", "SQL diagnostic section 11"],
    ["8", "Reconcile creates one project + unscheduled visit", "roles script + test job"],
    ["9", "Reconcile idempotency", "roles script + test job"],
    ["10", "Delivery-only lines excluded", "DATABASE_URL or SQL: installation_quote_line_qualifies"],
  ]) {
    record(item[0], item[1], "UNVERIFIED", item[2]);
  }
} else {
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString: dbUrl });
  await client.connect();

  try {
    const { rows: tableCount } = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [TABLES]
    );

    record(
      "1c",
      "Eight installation tables in pg_catalog",
      tableCount[0]?.n === 8 ? "PASS" : "FAIL",
      `found ${tableCount[0]?.n ?? 0}`
    );

    const { rows: indexes } = await client.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      [REQUIRED_INDEXES]
    );
    record(
      "1d",
      "Key indexes (job_id unique, visit number unique)",
      indexes.length === REQUIRED_INDEXES.length ? "PASS" : "FAIL",
      indexes.map((r) => r.indexname).join(", ")
    );

    const { rows: rls } = await client.query(`
      SELECT bool_and(c.relrowsecurity) AS all_enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[]) AND c.relkind = 'r'
    `, [TABLES]);

    const { rows: policyCount } = await client.query(`
      SELECT count(*)::int AS n
      FROM pg_policy pol
      JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname LIKE 'installation_%'
    `);

    record(
      "1e",
      "RLS enabled on all installation tables",
      rls[0]?.all_enabled === true ? "PASS" : "FAIL",
      `policies on installation tables: ${policyCount[0]?.n ?? 0}`
    );

    const { rows: hardening } = await client.query(`
      SELECT
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'installation_visit_manager_reopen') AS reopen,
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'installation_visit_exists') AS visit_exists,
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'installation_storage_path_is_valid') AS path_valid
    `);

    const hardeningOk =
      hardening[0]?.reopen && hardening[0]?.visit_exists && hardening[0]?.path_valid;
    record("2", "Hardening migration objects in Postgres", hardeningOk ? "PASS" : "FAIL", JSON.stringify(hardening[0]));

    const { rows: delivery } = await client.query(`
      SELECT public.installation_quote_line_qualifies('Delivery to site') AS delivery_only,
             public.installation_quote_line_qualifies('Site installation') AS install_line
    `);
    const deliveryOk = delivery[0]?.delivery_only === false && delivery[0]?.install_line === true;
    record("10", "Delivery-only vs installation line detection", deliveryOk ? "PASS" : "FAIL", JSON.stringify(delivery[0]));

    const { rows: appendPriv } = await client.query(`
      SELECT has_function_privilege(
        'authenticated',
        'public.installation_append_visit_event(uuid,text,jsonb)',
        'EXECUTE'
      ) AS allowed
    `);
    record(
      "6a",
      "authenticated cannot EXECUTE installation_append_visit_event",
      appendPriv[0]?.allowed === false ? "PASS" : "FAIL",
      `allowed=${appendPriv[0]?.allowed}`
    );

    const { rows: storagePolicies } = await client.query(`
      SELECT count(*)::int AS n FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'installation_%'
    `);
    record(
      "7b",
      "Installation storage RLS policies",
      (storagePolicies[0]?.n ?? 0) >= 3 ? "PASS" : "FAIL",
      `count=${storagePolicies[0]?.n}`
    );

    record("3", "Role matrix", "UNVERIFIED", "Run node scripts/verify-installation-phase1-roles.mjs (same DATABASE_URL)");
    record("4", "Installer admin actions denied", "UNVERIFIED", "roles script");
    record("5", "Manager reopen + audit", "UNVERIFIED", "roles script");
    record("8", "Reconcile one project per job", "UNVERIFIED", "needs qualifying accepted job fixture");
    record("9", "Reconcile idempotency", "UNVERIFIED", "needs qualifying accepted job fixture");
  } finally {
    await client.end();
  }
}

const phase2Wiring = [
  ["lib/quote-status-response.ts", /installation_auto_reconcile:\s*true/],
  ["lib/jobs/create-from-quote.ts", /reconcileAcceptedInstallation/],
  ["lib/installations/reconcile.ts", /installation_reconcile_accepted_job/],
  ["lib/customer-quote-response.ts", /reconcileJobForAcceptedQuote/],
  ["lib/admin-quote-actions.ts", /ensureJobForAcceptedQuote/],
];
const wiringGaps = [];
for (const [rel, pattern] of phase2Wiring) {
  const src = readFileSync(`${root}/${rel}`, "utf8");
  if (!pattern.test(src)) wiringGaps.push(rel);
}
const reconcileSrc = readFileSync(`${root}/lib/installations/reconcile.ts`, "utf8");
if (/from\("installation_projects"\)/.test(reconcileSrc)) {
  wiringGaps.push("lib/installations/reconcile.ts inserts projects directly");
}
record(
  "11",
  "Quote acceptance wired to Phase 2 installation reconcile",
  wiringGaps.length === 0 ? "PASS" : "FAIL",
  wiringGaps.length === 0
    ? "customer and admin acceptance call installation_reconcile_accepted_job"
    : wiringGaps.join(", ")
);

console.log("\n--- JSON ---");
console.log(JSON.stringify({ testRef: TEST_REF, tableProbe, rpcProbe, checklist }, null, 2));

const failed = checklist.filter((c) => c.status === "FAIL");
const unverified = checklist.filter((c) => c.status === "UNVERIFIED");
if (failed.length) process.exit(1);
if (unverified.length) process.exit(3);
process.exit(0);
