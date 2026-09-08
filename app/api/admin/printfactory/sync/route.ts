import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { verifyApprovedCrmAdmin } from "@/lib/crm-auth";
import {
  logSyncFailure,
  normalizeSyncError,
} from "@/lib/printfactory/sync-errors";
import { syncPrintfactoryJobs } from "@/lib/printfactory/sync";
import { getPrintfactoryConnectionStatus } from "@/lib/printfactory/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type SyncRequestBody = {
  includeHistorical?: boolean;
};

function syncHttpStatus(result: Awaited<ReturnType<typeof syncPrintfactoryJobs>>) {
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
      imported: 0,
      updated: 0,
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

export async function POST(request: Request) {
  const supabase = await createClient();
  const auth = await verifyApprovedCrmAdmin(supabase);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let includeHistorical = false;

  try {
    const body = (await request.json()) as SyncRequestBody;
    includeHistorical = body.includeHistorical === true;
  } catch {
    includeHistorical = false;
  }

  try {
    const adminClient = createAdminClient();
    const result = await syncPrintfactoryJobs(adminClient, auth.userId, {
      includeHistorical,
    });

    revalidatePath("/admin/production");
    revalidatePath("/admin/production/printfactory-unmatched");

    return NextResponse.json(result, {
      status: syncHttpStatus(result),
    });
  } catch (error) {
    return buildUnhandledSyncFailureResponse(error);
  }
}
