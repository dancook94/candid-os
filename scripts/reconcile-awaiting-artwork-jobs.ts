/**
 * Reconcile jobs stuck in awaiting_artwork despite completed artwork uploads.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/reconcile-awaiting-artwork-jobs.ts
 *   npx tsx --env-file=.env.local scripts/reconcile-awaiting-artwork-jobs.ts J-1
 */

import { reconcileAwaitingArtworkJobStatuses } from "../lib/jobs/reconcile-awaiting-artwork-jobs";
import { createAdminClient } from "../lib/supabase/admin";

async function main() {
  const jobReference = process.argv[2]?.trim();
  const adminClient = createAdminClient();

  let jobId: string | undefined;

  if (jobReference) {
    const { data: job, error } = await adminClient
      .from("jobs")
      .select("id, job_reference, status")
      .eq("job_reference", jobReference)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!job) {
      throw new Error(`Job ${jobReference} was not found.`);
    }

    jobId = job.id;
    console.info("[reconcile-awaiting-artwork-jobs]", {
      jobReference: job.job_reference,
      jobId: job.id,
      currentStatus: job.status,
    });
  }

  const result = await reconcileAwaitingArtworkJobStatuses(adminClient, {
    jobId,
    trigger: "script_reconciliation",
    logActivity: true,
  });

  console.info("[reconcile-awaiting-artwork-jobs] complete", result);

  if (result.errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "[reconcile-awaiting-artwork-jobs] failed:",
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
});
