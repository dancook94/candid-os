import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const BIN = "/opt/homebrew/opt/postgresql@18/bin";
const PORT = "54347";
const QR = "11111111-1111-4111-8111-111111111111";
const FILE = "22222222-2222-4222-8222-222222222222";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = "2026-06-15 12:00:00+00";

const env = {
  ...process.env,
  LC_ALL: "en_GB.UTF-8",
  LANG: "en_GB.UTF-8",
};

function psqlArgs(dir: string, extra: string[]) {
  return ["-h", dir, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", ...extra];
}

async function psql(dir: string, sql: string) {
  const result = await exec(join(BIN, "psql"), psqlArgs(dir, ["-t", "-A", "-c", sql]), { env });
  return result.stdout.trim();
}

describe("website artwork database coordination", { concurrency: 1 }, () => {
  test("serialises chunks and preserves completed files", { timeout: 60_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "candid-artwork-"));
    const logFile = join(dir, "server.log");
    let started = false;

    try {
      await exec(join(BIN, "initdb"), ["-D", dir, "--username", "postgres", "--auth", "trust", "--no-sync"], {
        env,
      });
      await exec(
        join(BIN, "pg_ctl"),
        ["-D", dir, "-l", logFile, "-o", `-p ${PORT} -k ${dir} -c listen_addresses=`, "start"],
        { env }
      );
      started = true;

      await psql(
        dir,
        `
        CREATE SCHEMA IF NOT EXISTS auth;
        CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'service_role' $$;
        CREATE OR REPLACE FUNCTION public.is_candid_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
        DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        CREATE TABLE public.quote_requests (
          id uuid PRIMARY KEY,
          source text,
          external_submission_id text,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE public.quote_request_dropbox_files (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          quote_request_id uuid NOT NULL REFERENCES public.quote_requests (id) ON DELETE CASCADE,
          original_file_name text NOT NULL,
          dropbox_file_id text,
          dropbox_path text,
          file_size_bytes bigint,
          mime_type text,
          upload_status text NOT NULL DEFAULT 'pending',
          created_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT quote_request_dropbox_files_name_not_blank CHECK (btrim(original_file_name) <> ''),
          CONSTRAINT quote_request_dropbox_files_size_non_negative CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
          CONSTRAINT quote_request_dropbox_files_status_check CHECK (upload_status IN ('pending', 'uploaded', 'failed')),
          CONSTRAINT quote_request_dropbox_files_uploaded_location_check CHECK (
            upload_status <> 'uploaded' OR dropbox_file_id IS NOT NULL OR dropbox_path IS NOT NULL
          ),
          CONSTRAINT quote_request_dropbox_files_no_public_url CHECK (
            (dropbox_file_id IS NULL OR dropbox_file_id !~* '^https?://')
            AND (dropbox_path IS NULL OR dropbox_path !~* '^https?://')
          )
        );
        `
      );

      await exec(
        join(BIN, "psql"),
        psqlArgs(dir, ["-f", "supabase/migrations/20261020130000_website_artwork_upload_sessions.sql"]),
        { env, cwd: process.cwd() }
      );

      const claimPrivilege = await psql(
        dir,
        `SELECT has_function_privilege('authenticated', 'public.quote_request_dropbox_claim_chunk(uuid, uuid, bigint, integer, text, timestamptz)', 'EXECUTE')`
      );
      const expirePrivilege = await psql(
        dir,
        `SELECT has_function_privilege('authenticated', 'public.quote_request_dropbox_expire_enquiry(uuid, timestamptz)', 'EXECUTE')`
      );
      assert.equal(claimPrivilege, "f");
      assert.equal(expirePrivilege, "t");

      await psql(
        dir,
        `INSERT INTO public.quote_requests (id, source, external_submission_id) VALUES ('${QR}', 'website', 'web-1001')`
      );

      const folder = `/Candid Website Enquiries/2026/${QR} - Acme - Banner`;
      const reserved = JSON.parse(
        await psql(
          dir,
          `SELECT public.quote_request_dropbox_reserve_file('${QR}'::uuid, 'web-1001', 'poster.pdf', 'poster.pdf', '${folder}', 8, 'application/pdf', '${NOW}'::timestamptz)`
        )
      ) as { outcome: string; fileId: string; dropboxPath: string };
      assert.equal(reserved.outcome, "reserved");
      assert.equal(reserved.dropboxPath, `${folder}/poster.pdf`);

      await psql(
        dir,
        `SELECT public.quote_request_dropbox_attach_session('${reserved.fileId}'::uuid, '${QR}'::uuid, 'session-1', '${NOW}'::timestamptz)`
      );

      const firstClaim = exec(
        join(BIN, "psql"),
        psqlArgs(dir, [
          "-t",
          "-A",
          "-c",
          `BEGIN; SELECT public.quote_request_dropbox_claim_chunk('${reserved.fileId}'::uuid, '${QR}'::uuid, 0, 4, '${HASH_A}', '${NOW}'::timestamptz); SELECT pg_sleep(1); COMMIT;`,
        ]),
        { env }
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
      const secondClaim = await psql(
        dir,
        `SET lock_timeout = '5s'; SELECT public.quote_request_dropbox_claim_chunk('${reserved.fileId}'::uuid, '${QR}'::uuid, 0, 4, '${HASH_A}', '${NOW}'::timestamptz)`
      );
      const firstOutput = (await firstClaim).stdout;
      assert.match(firstOutput, /"outcome"\s*:\s*"proceed"/);
      assert.match(secondClaim, /"outcome"\s*:\s*"busy"/);

      const committed = JSON.parse(
        await psql(
          dir,
          `SELECT public.quote_request_dropbox_commit_chunk('${reserved.fileId}'::uuid, '${QR}'::uuid, 0, 4, '${HASH_A}', '${NOW}'::timestamptz)`
        )
      ) as { outcome: string; committedOffset: number };
      assert.equal(committed.outcome, "committed");
      assert.equal(committed.committedOffset, 4);

      const duplicate = JSON.parse(
        await psql(
          dir,
          `SELECT public.quote_request_dropbox_claim_chunk('${reserved.fileId}'::uuid, '${QR}'::uuid, 0, 4, '${HASH_A}', '${NOW}'::timestamptz)`
        )
      ) as { outcome: string };
      const conflict = JSON.parse(
        await psql(
          dir,
          `SELECT public.quote_request_dropbox_claim_chunk('${reserved.fileId}'::uuid, '${QR}'::uuid, 0, 4, '${HASH_B}', '${NOW}'::timestamptz)`
        )
      ) as { outcome: string };
      const gap = JSON.parse(
        await psql(
          dir,
          `SELECT public.quote_request_dropbox_claim_chunk('${reserved.fileId}'::uuid, '${QR}'::uuid, 8, 4, '${HASH_A}', '${NOW}'::timestamptz)`
        )
      ) as { outcome: string };
      assert.equal(duplicate.outcome, "duplicate");
      assert.equal(conflict.outcome, "conflict");
      assert.equal(gap.outcome, "gap");

      await psql(
        dir,
        `INSERT INTO public.quote_request_dropbox_files (id, quote_request_id, original_file_name, file_size_bytes, upload_status, dropbox_upload_session_id, upload_session_offset, session_expires_at, dropbox_path)
         VALUES ('${FILE}', '${QR}', 'old.pdf', 4, 'pending', 'session-old', 0, '2020-01-01 00:00:00+00', '${folder}/old.pdf')`
      );
      const expired = JSON.parse(
        await psql(
          dir,
          `SELECT public.quote_request_dropbox_claim_chunk('${FILE}'::uuid, '${QR}'::uuid, 0, 4, '${HASH_A}', '${NOW}'::timestamptz)`
        )
      ) as { outcome: string };
      const expiredStatus = await psql(
        dir,
        `SELECT upload_status || ':' || coalesce(dropbox_upload_session_id, '') FROM public.quote_request_dropbox_files WHERE id = '${FILE}'`
      );
      assert.equal(expired.outcome, "expired");
      assert.equal(expiredStatus, "failed:");

      await psql(
        dir,
        `UPDATE public.quote_request_dropbox_files SET upload_status = 'uploaded', dropbox_file_id = 'id:kept', dropbox_upload_session_id = NULL WHERE id = '${reserved.fileId}'`
      );
      await psql(
        dir,
        `SELECT public.quote_request_dropbox_expire_enquiry('${QR}'::uuid, '${NOW}'::timestamptz)`
      );
      const kept = await psql(
        dir,
        `SELECT upload_status FROM public.quote_request_dropbox_files WHERE id = '${reserved.fileId}'`
      );
      assert.equal(kept, "uploaded");

      let limit = "";
      for (let index = 0; index < 12; index += 1) {
        limit = await psql(
          dir,
          `SELECT public.quote_request_dropbox_reserve_file('${QR}'::uuid, 'web-1001', 'extra-${index}.pdf', 'extra-${index}.pdf', '${folder}', 4, 'application/pdf', '${NOW}'::timestamptz)->>'outcome'`
        );
      }
      assert.equal(limit, "file_limit");

      await psql(dir, `CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'authenticated' $$`);
      try {
        await psql(
          dir,
          `SELECT public.quote_request_dropbox_claim_chunk('${FILE}'::uuid, '${QR}'::uuid, 0, 4, '${HASH_A}', '${NOW}'::timestamptz)`
        );
        assert.fail("A customer session was able to claim an upload.");
      } catch (error) {
        const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
        assert.match(`${error}\n${stderr}`, /server-only|42501/);
      }
    } finally {
      if (started) {
        await exec(join(BIN, "pg_ctl"), ["-D", dir, "stop", "-m", "immediate"], { env }).catch(() => undefined);
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
});
