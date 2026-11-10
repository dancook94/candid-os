import type { SupabaseClient } from "@supabase/supabase-js";

import { HISTORICAL_RECONCILE_SKIP_REASON } from "@/lib/installations/classification";
import { InstallationError, isMissingInstallationSchemaError } from "@/lib/installations/errors";

export type InstallationReconcileResult = {
  jobId: string;
  projectId: string | null;
  createdProject: boolean;
  createdInitialVisit: boolean;
  skippedReason: string | null;
  signalCount: number;
};

type ReconcileRpcRow = {
  job_id?: string;
  project_id?: string | null;
  created_project?: boolean;
  created_initial_visit?: boolean;
  skipped_reason?: string | null;
};

/**
 * Calls the Phase 1 SQL writer through the service-role acceptance entry.
 * This function does not insert installation projects or visits itself.
 */
export async function reconcileInstallationProjectForJob(
  adminClient: SupabaseClient,
  jobId: string,
  options?: { actorProfileId?: string | null }
): Promise<InstallationReconcileResult> {
  const { data, error } = await adminClient.rpc("installation_reconcile_accepted_job", {
    p_job_id: jobId,
    p_actor: options?.actorProfileId ?? null,
  });

  if (error) {
    if (isMissingInstallationSchemaError(error.message)) {
      throw new InstallationError(
        "Installation acceptance reconcile is not available. Apply migration 20270110168000 on Test Supabase.",
        503
      );
    }

    throw new InstallationError(error.message, 500);
  }

  const row = (data ?? {}) as ReconcileRpcRow;

  return {
    jobId: row.job_id ?? jobId,
    projectId: row.project_id ?? null,
    createdProject: row.created_project === true,
    createdInitialVisit: row.created_initial_visit === true,
    skippedReason: row.skipped_reason ?? null,
    signalCount: row.created_project || row.project_id ? 1 : 0,
  };
}

export async function reconcileAcceptedInstallation(
  adminClient: SupabaseClient,
  input: {
    jobId: string;
    quoteId: string;
    quoteVersionId: string | null;
    actorProfileId?: string | null;
  }
): Promise<string | null> {
  try {
    const result = await reconcileInstallationProjectForJob(adminClient, input.jobId, {
      actorProfileId: input.actorProfileId,
    });

    if (result.skippedReason === HISTORICAL_RECONCILE_SKIP_REASON || !input.quoteVersionId) {
      return null;
    }

    await recordReconcileStatus(adminClient, input.quoteVersionId, {
      status: result.skippedReason ? "skipped" : "succeeded",
      error: null,
    });

    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[installations] reconcile failed", {
      quoteId: input.quoteId,
      jobId: input.jobId,
      message,
    });

    if (input.quoteVersionId) {
      await recordReconcileStatus(adminClient, input.quoteVersionId, {
        status: "failed",
        error: message,
      });
    }

    return "The quote and job were saved, but installation setup did not finish. Retry it from this quote.";
  }
}

async function recordReconcileStatus(
  adminClient: SupabaseClient,
  quoteVersionId: string,
  input: { status: "succeeded" | "failed" | "skipped"; error: string | null }
) {
  const { error } = await adminClient
    .from("quote_versions")
    .update({
      installation_reconcile_status: input.status,
      installation_reconcile_error: input.error,
      installation_reconciled_at: new Date().toISOString(),
    })
    .eq("id", quoteVersionId);

  if (error) {
    console.error("[installations] reconcile status was not saved", {
      quoteVersionId,
      message: error.message,
    });
  }
}
