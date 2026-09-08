import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmAdmin } from "@/lib/crm-auth";
import {
  logSyncFailure,
  normalizeSyncError,
} from "@/lib/printfactory/sync-errors";
import { syncLivePrintfactoryJobs } from "@/lib/printfactory/sync-live";
import { getPrintfactoryConnectionStatus } from "@/lib/printfactory/client";
import type { PrintfactorySyncResult } from "@/lib/printfactory/sync-engine";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function syncHttpStatus(result: PrintfactorySyncResult) {
  if (result.ok) {
    return 200;
  }

  if (result.partial) {
    return 200;
  }

  if (result.errorCode === "not_configured") {
    return 503;
  }

  if (result.errorCode === "migration_required") {
    return 503;
  }

  if (result.errorCode === "sync_locked") {
    return 409;
  }

  return 502;
}

function buildUnhandledSyncFailureResponse(error: unknown) {
  const normalized = normalizeSyncError(error);

  logSyncFailure({
    failingStage: null,
    error,
    recordsReceived: 0,
    imported: 0,
    updated: 0,
  });

  return NextResponse.json(
    {
      ok: false,
      partial: false,
      syncMode: "live",
      imported: 0,
      updated: 0,
      refreshed: 0,
      recordsReceived: 0,
      failingStage: null,
      error: normalized.safeMessage,
      safeMessage: normalized.safeMessage,
      errorCode: normalized.errorCode,
      connectionStatus: getPrintfactoryConnectionStatus(),
      summaryMessage: null,
    },
    { status: 502 }
  );
}

/** Manual admin action — runs live incremental sync. */
export async function POST(request: Request) {
  void request;
  const supabase = await createClient();
  const auth = await verifyApprovedCrmAdmin(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const adminClient = createAdminClient();
    const result = await syncLivePrintfactoryJobs(adminClient, auth.userId);

    revalidatePath("/admin/production");
    revalidatePath("/admin/production/printfactory-unmatched");

    return NextResponse.json(result, {
      status: syncHttpStatus(result),
    });
  } catch (error) {
    return buildUnhandledSyncFailureResponse(error);
  }
}
