/**
 * Reconcile a job_files record against Dropbox when upload_status is failed/pending
 * but the file exists in Dropbox.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/reconcile-artwork-upload.ts <job_file_id>
 *
 * Example (J-1 one-time repair):
 *   npx tsx --env-file=.env.local scripts/reconcile-artwork-upload.ts bd61e5f4-5359-4675-a63f-be2e411dc875
 */

import { reconcileArtworkUploadRecord } from "../lib/jobs/reconcile-artwork-upload";
import { createAdminClient } from "../lib/supabase/admin";

async function main() {
  const jobFileId = process.argv[2]?.trim();

  if (!jobFileId) {
    throw new Error("Usage: reconcile-artwork-upload.ts <job_file_id>");
  }

  const adminClient = createAdminClient();
  const { data: file, error } = await adminClient
    .from("job_files")
    .select("id, job_id, upload_status, file_name")
    .eq("id", jobFileId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!file) {
    throw new Error(`job_files record ${jobFileId} was not found.`);
  }

  console.info("[reconcile-artwork-upload] starting", {
    jobFileId: file.id,
    jobId: file.job_id,
    fileName: file.file_name,
    currentUploadStatus: file.upload_status,
  });

  const result = await reconcileArtworkUploadRecord(adminClient, {
    jobFileId,
    trigger: "script_artwork_upload_reconciliation",
    logActivity: true,
  });

  console.info("[reconcile-artwork-upload] complete", result);

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "[reconcile-artwork-upload] failed:",
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
});
