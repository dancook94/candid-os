#!/usr/bin/env node
/**
 * Reconcile one accepted quote into a job using the same server logic as the app.
 * Requires public.jobs to exist (run scripts/apply-jobs-migration.sh first).
 *
 * Usage:
 *   node --env-file=.env.local scripts/reconcile-accepted-quote.mjs [quoteId]
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

process.chdir(root);

const quoteId =
  process.argv[2] ?? "12ebf8dc-417a-47aa-84f4-72e625d8fede";

async function main() {
  const require = createRequire(import.meta.url);

  // Load compiled TS through Next's tsconfig paths via tsx when available.
  let reconcileJobForAcceptedQuote;

  try {
    const tsx = await import("tsx/esm/api").catch(() => null);
    if (tsx?.register) {
      tsx.register();
    }

    ({ reconcileJobForAcceptedQuote } = await import(
      pathToFileURL(path.join(root, "lib/jobs/create-from-quote.ts")).href
    ));
  } catch (error) {
    console.error(
      "Unable to load TypeScript reconcile module. Install tsx or run Create missing job from the admin quote page after migration."
    );
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const result = await reconcileJobForAcceptedQuote({ quoteId });

  console.log(JSON.stringify(result, null, 2));

  if (result.schemaMissing) {
    process.exit(2);
  }

  if (!result.job) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
