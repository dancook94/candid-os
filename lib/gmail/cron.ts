import type { SupabaseClient } from "@supabase/supabase-js";

import type { GmailDiscoveryClient } from "@/lib/gmail/client";
import {
  GMAIL_CRON_BUDGET_MS,
  GMAIL_CRON_MAX_BATCHES,
  GMAIL_IMPORT_MAILBOX,
  GMAIL_ONGOING_SYNC_ENABLED,
  GMAIL_SYNC_OVERLAP_MINUTES,
} from "@/lib/gmail/config";
import { stepGmailDiscovery } from "@/lib/gmail/discovery";
import { sanitizeGmailError } from "@/lib/gmail/errors";
import { planOngoingDiscovery, type OngoingDiscoveryDecision } from "@/lib/gmail/sync-plan";

export type GmailDiscoveryStepResult = {
  status: "running" | "paused" | "completed";
  busy?: boolean;
  rateLimited?: boolean;
  retryAfterSeconds?: number;
};

export type GmailCronResult = {
  ok: boolean;
  status: "idle" | "running" | "paused" | "completed" | "attention";
  batches: number;
  rateLimited: boolean;
  retryAfterSeconds?: number;
  needsAttention: boolean;
  error?: string;
  ongoing: OngoingDiscoveryDecision;
};

async function ongoingDecision(
  admin: SupabaseClient,
  backfillActive: boolean,
  now: Date
): Promise<OngoingDiscoveryDecision> {
  const { data: connection, error: connectionError } = await admin
    .from("gmail_connections")
    .select("id")
    .eq("mailbox", GMAIL_IMPORT_MAILBOX)
    .maybeSingle();

  if (connectionError || !connection?.id) {
    return planOngoingDiscovery({
      enabled: false,
      backfillActive,
      now,
      scannedThrough: null,
    });
  }

  const { data, error } = await admin
    .from("gmail_sync_checkpoints")
    .select("enabled, overlap_minutes, scanned_through")
    .eq("connection_id", connection.id)
    .maybeSingle();
  const enabled = Boolean(data?.enabled) && GMAIL_ONGOING_SYNC_ENABLED;

  if (error) {
    return planOngoingDiscovery({
      enabled: false,
      backfillActive,
      now,
      scannedThrough: null,
    });
  }

  return planOngoingDiscovery({
    enabled,
    backfillActive,
    now,
    scannedThrough: (data?.scanned_through as string | null) ?? null,
    overlapMinutes: Number(data?.overlap_minutes ?? GMAIL_SYNC_OVERLAP_MINUTES),
  });
}

export async function runGmailDiscoveryCron(input: {
  admin: SupabaseClient;
  client?: GmailDiscoveryClient;
  now?: Date;
  budgetMs?: number;
  maxBatches?: number;
  step?: (admin: SupabaseClient) => Promise<GmailDiscoveryStepResult>;
}): Promise<GmailCronResult> {
  const deadline = Date.now() + (input.budgetMs ?? GMAIL_CRON_BUDGET_MS);
  const maxBatches = input.maxBatches ?? GMAIL_CRON_MAX_BATCHES;
  const step =
    input.step ??
    ((admin: SupabaseClient) => stepGmailDiscovery({ admin, client: input.client }));
  let batches = 0;
  let status: GmailCronResult["status"] = "idle";
  let rateLimited = false;
  let retryAfterSeconds: number | undefined;
  let needsAttention = false;
  let errorMessage: string | undefined;

  while (batches < maxBatches && Date.now() < deadline) {
    try {
      const result = await step(input.admin);
      batches += 1;
      status = result.status;

      if (result.busy) {
        status = "running";
        break;
      }

      if (result.rateLimited) {
        rateLimited = true;
        retryAfterSeconds = result.retryAfterSeconds;
        status = "running";
        break;
      }

      if (result.status !== "running") {
        break;
      }
    } catch (error) {
      const message = sanitizeGmailError(error);

      if (
        /no discovery to continue|connect gmail before starting discovery/i.test(message)
      ) {
        status = "idle";
        break;
      }

      needsAttention = true;
      status = "attention";
      errorMessage = message;
      break;
    }
  }

  let ongoing: OngoingDiscoveryDecision;
  try {
    ongoing = await ongoingDecision(
      input.admin,
      status === "running" || status === "paused",
      input.now ?? new Date()
    );
  } catch {
    ongoing = planOngoingDiscovery({
      enabled: false,
      backfillActive: status === "running" || status === "paused",
      now: input.now ?? new Date(),
      scannedThrough: null,
    });
  }

  return {
    ok: !needsAttention,
    status,
    batches,
    rateLimited,
    retryAfterSeconds,
    needsAttention,
    error: errorMessage,
    ongoing,
  };
}
