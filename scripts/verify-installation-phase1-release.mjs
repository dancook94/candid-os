/**
 * Installation Phase 1 release gate (Test: axhkdwgmwhlbsstumndh).
 * PASS / FAIL / UNVERIFIED — does not deploy.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  loadInstallationTestEnv,
  installationTestSupabaseReady,
  missingInstallationTestSupabaseHints,
} from "./lib/installation-phase1-test-env.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const envMeta = loadInstallationTestEnv(root);

if (!installationTestSupabaseReady()) {
  const hints = missingInstallationTestSupabaseHints(root);
  console.error(
    `Refusing release gate: missing Test Supabase configuration:\n  - ${hints.join("\n  - ")}`
  );
  process.exit(2);
}
console.log(
  `Test env: NEXT_PUBLIC_SUPABASE_URL from ${envMeta.supabaseUrlSource ?? "unknown"}; ` +
    `SUPABASE_SERVICE_ROLE_KEY from ${envMeta.serviceRoleSource ?? "unknown"} (secrets not shown).`
);

/** @type {{ layer: string, status: string, detail?: string }[]} */
const gate = [];

function runNode(script) {
  const result = spawnSync("node", [`${root}/scripts/${script}`], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  return result;
}

const api = runNode("verify-installation-phase1-final.mjs");
if (api.status === 0) {
  gate.push({ layer: "postgrest", status: "PASS", detail: "verify-installation-phase1-final.mjs" });
} else if (api.status === 3) {
  gate.push({ layer: "postgrest", status: "PASS", detail: "with UNVERIFIED pg items" });
} else {
  gate.push({ layer: "postgrest", status: "FAIL", detail: api.stderr || api.stdout });
}

const roles = runNode("verify-installation-phase1-roles.mjs");
if (roles.status === 0) {
  gate.push({
    layer: "postgres_roles",
    status: "PASS",
    detail: "rollback-only JWT claim simulation (not live JWT)",
  });
} else if (roles.status === 2) {
  gate.push({
    layer: "postgres_roles",
    status: "UNVERIFIED",
    detail: "Set Test DATABASE_URL and re-run scripts/verify-installation-phase1-roles.mjs",
  });
} else if (roles.status === 3) {
  gate.push({
    layer: "postgres_roles",
    status: "UNVERIFIED",
    detail: roles.stdout || roles.stderr || "critical checks unverified",
  });
} else {
  gate.push({ layer: "postgres_roles", status: "FAIL", detail: roles.stdout || roles.stderr });
}

console.log("\nInstallation Phase 1 release gate\n");
for (const row of gate) {
  console.log(`${row.status.padEnd(10)} ${row.layer} — ${row.detail ?? ""}`);
}

console.log("\nSQL Editor (read-only catalog): scripts/verify-installation-phase1-complete.sql");

const criticalFail = gate.some((g) => g.status === "FAIL");
const criticalUnverified = gate.some((g) => g.status === "UNVERIFIED");

console.log("\nGate policy: FAIL or UNVERIFIED blocks release (fail closed).");

if (criticalFail) process.exit(1);
if (criticalUnverified) process.exit(3);
process.exit(0);
