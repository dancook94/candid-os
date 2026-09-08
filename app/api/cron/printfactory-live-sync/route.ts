import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import {
  logSyncFailure,
  normalizeSyncError,
} from "@/lib/printfactory/sync-errors";
import { syncLivePrintfactoryJobs } from "@/lib/printfactory/sync-live";
import { getPrintfactoryConnectionStatus } from "@/lib/printfactory/client";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Prepared for future Vercel Cron — NOT scheduled in vercel.json yet.
 * Protect with CRON_SECRET (Authorization: Bearer <secret>).
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured." },
      { status: 503 }
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (!token || token !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const adminClient = createAdminClient();
    const result = await syncLivePrintfactoryJobs(adminClient, null);

    revalidatePath("/admin/production");
    revalidatePath("/admin/production/printfactory-unmatched");

    return NextResponse.json(result, {
      status: result.ok || result.partial ? 200 : 502,
    });
  } catch (error) {
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
        syncMode: "live",
        error: normalized.safeMessage,
        safeMessage: normalized.safeMessage,
        errorCode: normalized.errorCode,
        connectionStatus: getPrintfactoryConnectionStatus(),
      },
      { status: 502 }
    );
  }
}
