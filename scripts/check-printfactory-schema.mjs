#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { checkPrintfactorySchemaReadiness } from "../lib/printfactory/schema-readiness.ts";

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

const result = await checkPrintfactorySchemaReadiness(admin);

console.log(
  JSON.stringify(
    {
      ready: result.ready,
      missingTables: result.missingTables,
      missingColumns: result.missingColumns,
      queryErrors: result.queryErrors,
      message: result.message,
      printfactory_jobs:
        result.missingTables.includes("public.printfactory_jobs") ||
        result.missingColumns.some((column) =>
          column.startsWith("public.printfactory_jobs.")
        )
          ? "missing"
          : "ok",
      printfactory_job_manifest_items: result.missingTables.includes(
        "public.printfactory_job_manifest_items"
      )
        ? "missing"
        : "ok",
      printfactory_mapping_rules: result.missingTables.includes(
        "public.printfactory_mapping_rules"
      )
        ? "missing"
        : "ok",
      columnErrors: Object.fromEntries(
        result.missingColumns
          .filter((column) => column.startsWith("public.printfactory_jobs."))
          .map((column) => [
            column.replace("public.printfactory_jobs.", ""),
            "missing",
          ])
      ),
    },
    null,
    2
  )
);

process.exit(result.ready ? 0 : 1);
