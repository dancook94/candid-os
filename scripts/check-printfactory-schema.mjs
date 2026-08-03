#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // optional
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const REQUIRED_COLUMNS = [
  "raw_metadata",
  "job_match_status",
  "job_match_method",
  "job_match_confidence",
  "extracted_job_reference",
  "candid_job_id",
  "source_file_path",
  "source_file_name",
];

async function probeTable(tableName) {
  const { error } = await admin.from(tableName).select("id").limit(0);
  return error;
}

async function probeColumn(column) {
  const { error } = await admin.from("printfactory_jobs").select(column).limit(0);
  return error;
}

const jobsTableError = await probeTable("printfactory_jobs");
const linkTableError = await probeTable("printfactory_job_manifest_items");

const columnErrors = {};
for (const column of REQUIRED_COLUMNS) {
  const error = await probeColumn(column);
  if (error) columnErrors[column] = error.message;
}

console.log(
  JSON.stringify(
    {
      printfactory_jobs: jobsTableError?.message ?? "ok",
      printfactory_job_manifest_items: linkTableError?.message ?? "ok",
      columnErrors,
    },
    null,
    2
  )
);
