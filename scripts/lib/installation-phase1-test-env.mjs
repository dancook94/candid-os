/**
 * Test-only env for Installation Phase 1 verification (axhkdwgmwhlbsstumndh).
 * Verification scripts always use Test Supabase from repo files — never Live shell exports.
 * Never logs secrets.
 */
import { readFileSync, existsSync } from "node:fs";

export const INSTALLATION_TEST_REF = "axhkdwgmwhlbsstumndh";

const TEST_ENV_FILE_ORDER = [".env.vercel.test.local", ".env.local"];

const INSTALLATION_TABLES = [
  "installation_projects",
  "installation_visits",
  "installation_visit_assignments",
  "installation_visit_documents",
  "installation_visit_photos",
  "installation_snag_items",
  "installation_sign_offs",
  "installation_visit_events",
];

export function unquoteEnvValue(raw) {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function isValidSupabaseHttpUrl(url) {
  const u = url.trim();
  return /^https?:\/\/[^\s]+$/i.test(u) && u.length > 16;
}

export function normalizeSupabaseUrl(raw) {
  if (!raw) return "";
  const u = unquoteEnvValue(String(raw));
  return isValidSupabaseHttpUrl(u) ? u : "";
}

/**
 * @param {string} path
 * @returns {Map<string, string>}
 */
function parseEnvFile(path) {
  /** @type {Map<string, string>} */
  const map = new Map();
  if (!existsSync(path)) return map;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#")) continue;
    const m = stripped.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    map.set(m[1], unquoteEnvValue(m[2]));
  }
  return map;
}

/**
 * First file in order wins per key (.env.vercel.test.local before .env.local).
 * @param {string} root
 */
export function readInstallationEnvFiles(root) {
  /** @type {Map<string, string>} */
  const merged = new Map();
  /** @type {Map<string, string>} */
  const sourceByKey = new Map();
  for (const name of TEST_ENV_FILE_ORDER) {
    const path = `${root}/${name}`;
    const parsed = parseEnvFile(path);
    for (const [key, value] of parsed) {
      if (!merged.has(key)) {
        merged.set(key, value);
        sourceByKey.set(key, name);
      }
    }
  }
  return { merged, sourceByKey };
}

function pickTestSupabaseUrlFromLocal(merged) {
  const candidates = [merged.get("NEXT_PUBLIC_SUPABASE_URL"), merged.get("SUPABASE_URL")].filter(
    Boolean
  );
  return candidates.find((u) => u.includes(INSTALLATION_TEST_REF)) ?? "";
}

/** @type {boolean} */
let usedVercelTestEnvFile = false;

/**
 * Force Test PostgREST config from repo env files (ignore Live shell exports).
 */
export function loadInstallationTestEnv(root) {
  usedVercelTestEnvFile = false;
  const vercelPath = `${root}/.env.vercel.test.local`;
  const vercel = parseEnvFile(vercelPath);
  const vercelUrlRaw = vercel.get("NEXT_PUBLIC_SUPABASE_URL") ?? vercel.get("SUPABASE_URL");
  const vercelUrl = normalizeSupabaseUrl(vercelUrlRaw);

  if (vercelUrl) {
    const liveRefs = [process.env.CANDID_LIVE_SUPABASE_PROJECT_REF?.trim()].filter(Boolean);
    if (liveRefs.some((ref) => vercelUrl.includes(ref))) {
      throw new Error(
        "Refusing: .env.vercel.test.local URL matches configured Live project ref"
      );
    }
    usedVercelTestEnvFile = true;
    process.env.NEXT_PUBLIC_SUPABASE_URL = vercelUrl;
    const vercelKey = vercel.get("SUPABASE_SERVICE_ROLE_KEY");
    if (vercelKey) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = vercelKey;
    }
  } else {
    const { merged } = readInstallationEnvFiles(root);
    const testUrl = normalizeSupabaseUrl(pickTestSupabaseUrlFromLocal(merged));
    if (testUrl) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = testUrl;
      const key = merged.get("SUPABASE_SERVICE_ROLE_KEY");
      if (key) {
        process.env.SUPABASE_SERVICE_ROLE_KEY = key;
      }
    }
  }

  const { merged, sourceByKey } = readInstallationEnvFiles(root);
  const dbFromFiles = merged.get("DATABASE_URL");
  const dbShell = process.env.DATABASE_URL?.trim() ?? "";
  if (dbFromFiles?.includes(INSTALLATION_TEST_REF)) {
    if (!dbShell.includes(INSTALLATION_TEST_REF)) {
      process.env.DATABASE_URL = dbFromFiles;
    }
  }

  return {
    supabaseUrlSource: usedVercelTestEnvFile
      ? ".env.vercel.test.local"
      : pickTestSupabaseUrlFromLocal(merged)
        ? sourceByKey.get("NEXT_PUBLIC_SUPABASE_URL") ??
          sourceByKey.get("SUPABASE_URL") ??
          ".env.local"
        : null,
    serviceRoleSource: usedVercelTestEnvFile
      ? ".env.vercel.test.local"
      : merged.get("SUPABASE_SERVICE_ROLE_KEY")
        ? sourceByKey.get("SUPABASE_SERVICE_ROLE_KEY") ?? ".env.local"
        : null,
    databaseUrlSource:
      process.env.DATABASE_URL?.includes(INSTALLATION_TEST_REF)
        ? sourceByKey.get("DATABASE_URL") ?? (dbShell.includes(INSTALLATION_TEST_REF) ? "shell" : null)
        : null,
    trustedTestFile: usedVercelTestEnvFile,
  };
}

export function resolveInstallationDatabaseUrl(root) {
  const { merged } = readInstallationEnvFiles(root);
  const fromFile = merged.get("DATABASE_URL");
  if (fromFile?.includes(INSTALLATION_TEST_REF)) return fromFile;
  const fromEnv = process.env.DATABASE_URL?.trim();
  if (fromEnv?.includes(INSTALLATION_TEST_REF)) return fromEnv;
  return null;
}

export function installationTestSupabaseReady() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!isValidSupabaseHttpUrl(url) || !key) return false;
  if (usedVercelTestEnvFile) return true;
  return url.includes(INSTALLATION_TEST_REF);
}

export function missingInstallationTestSupabaseHints(root) {
  const hints = [];
  const vercel = parseEnvFile(`${root}/.env.vercel.test.local`);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  if (!url) {
    hints.push(
      existsSync(`${root}/.env.vercel.test.local`)
        ? "NEXT_PUBLIC_SUPABASE_URL missing in .env.vercel.test.local"
        : "add .env.vercel.test.local with Test NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY"
    );
  } else if (!usedVercelTestEnvFile && !url.includes(INSTALLATION_TEST_REF)) {
    hints.push(
      `shell/.env.local URL is not Test — use .env.vercel.test.local or include ${INSTALLATION_TEST_REF} in URL`
    );
  }
  if (!vercel.get("NEXT_PUBLIC_SUPABASE_URL") && !vercel.get("SUPABASE_URL")) {
    if (!existsSync(`${root}/.env.vercel.test.local`)) {
      hints.push("recommended: .env.vercel.test.local (Test-only; no Live shell leakage)");
    }
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    hints.push("SUPABASE_SERVICE_ROLE_KEY in .env.vercel.test.local (Test project)");
  }
  return hints;
}

const RLS_HELPERS = [
  "public.is_approved_installation_reader()",
  "public.is_approved_installation_operator()",
  "public.is_approved_installation_manager()",
];

/** pg_catalog: EXECUTE on RLS helper functions (migration 167000). */
export async function queryInstallationRlsHelperGrantCount(client) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n
     FROM unnest($1::text[]) AS fn(sig)
     WHERE has_function_privilege('authenticated', sig, 'EXECUTE')`,
    [RLS_HELPERS]
  );
  return rows[0]?.n ?? 0;
}

/** pg_catalog: authenticated SELECT grants (migration 166000). */
export async function queryInstallationSelectGrantCount(client) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n
     FROM unnest($1::text[]) AS table_name(name)
     WHERE has_table_privilege('authenticated', format('public.%I', name), 'SELECT')`,
  [INSTALLATION_TABLES]
  );
  return rows[0]?.n ?? 0;
}
