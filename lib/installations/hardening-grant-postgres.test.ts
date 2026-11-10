import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const REPAIR = new URL(
  "../../supabase/migrations/20270110165000_installation_phase1_hardening_repair.sql",
  import.meta.url
);

function dockerAvailable() {
  const result = spawnSync("docker", ["info"], { stdio: "ignore" });
  return result.status === 0;
}

test(
  "manager reopen GRANT (uuid, text, text) matches Postgres overload lookup",
  { skip: !dockerAvailable() },
  async () => {
    const containerName = `installation-grant-${process.pid}`;
    const probe = `
BEGIN;
CREATE OR REPLACE FUNCTION public.installation_visit_manager_reopen(
  p_visit_id uuid,
  p_reason text,
  p_target_status text DEFAULT 'scheduled'
)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;

SELECT to_regprocedure('public.installation_visit_manager_reopen(uuid, text, text)') IS NOT NULL AS reg_three;

DO $precheck$
BEGIN
  IF to_regprocedure('public.installation_visit_manager_reopen(uuid, text, text)') IS NULL THEN
    RAISE EXCEPTION 'missing before grant';
  END IF;
END;
$precheck$;

GRANT EXECUTE ON FUNCTION public.installation_visit_manager_reopen(uuid, text, text) TO PUBLIC;

ROLLBACK;
`;

    try {
      execFileSync(
        "docker",
        [
          "run",
          "-d",
          "--name",
          containerName,
          "-e",
          "POSTGRES_PASSWORD=postgres",
          "postgres:16-alpine",
        ],
        { stdio: "pipe" }
      );

      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (
          spawnSync("docker", ["exec", containerName, "pg_isready", "-U", "postgres"])
            .status === 0
        ) {
          break;
        }
        execFileSync("sleep", ["1"]);
      }

      const out = execFileSync(
        "docker",
        ["exec", "-i", containerName, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A"],
        { input: probe, encoding: "utf8" }
      );

      assert.match(out, /t/);
    } finally {
      spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
    }
  }
);

test(
  "165000 hardening repair applies on disposable Postgres after phase 1 stubs",
  { skip: !dockerAvailable() },
  async () => {
    const containerName = `installation-repair-${process.pid}`;
    const stubs = await readFile(
      new URL("./migration-compile.stubs.sql", import.meta.url),
      "utf8"
    );
    const phase1 = await readFile(
      new URL(
        "../../supabase/migrations/20270110163000_installation_management_phase1.sql",
        import.meta.url
      ),
      "utf8"
    );
    const repair = await readFile(REPAIR, "utf8");
    const verify = `
SELECT count(*) FILTER (
  WHERE p.proname IN (
    'installation_storage_visit_id_from_path',
    'installation_storage_path_is_valid',
    'installation_visit_exists',
    'installation_visit_manager_reopen'
  )
)::int AS hardening_fn_count
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public';

SELECT has_function_privilege(
  'authenticated',
  'public.installation_visit_manager_reopen(uuid, text, text)',
  'EXECUTE'
) AS auth_can_reopen;
`;

    try {
      execFileSync(
        "docker",
        [
          "run",
          "-d",
          "--name",
          containerName,
          "-e",
          "POSTGRES_PASSWORD=postgres",
          "postgres:16-alpine",
        ],
        { stdio: "pipe" }
      );

      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (
          spawnSync("docker", ["exec", containerName, "pg_isready", "-U", "postgres"])
            .status === 0
        ) {
          break;
        }
        execFileSync("sleep", ["1"]);
      }

      execFileSync(
        "docker",
        ["exec", "-i", containerName, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"],
        { input: `${stubs}\n${phase1}\n${repair}\n${verify}`, stdio: "pipe" }
      );
    } finally {
      spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
    }
  }
);
